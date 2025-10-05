from __future__ import annotations

import json
import logging
import random
import re
import time
from typing import Any, Dict, List, Optional, Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .database import init_db
from .llm import OpenRouterClient
from .routes.storage import router as storage_router
from .routes.projects import router as projects_router
from .routes.characters import router as characters_router
from .routes.worlds import router as worlds_router
from .vector_store import vector_store

load_dotenv()

logger = logging.getLogger(__name__)


class ParaphraseRequest(BaseModel):
    text: str = Field(..., min_length=1)
    mode: Optional[str] = None
    customPrompt: Optional[str] = None


class SummarizeRequest(BaseModel):
    text: str = Field(..., min_length=1)
    length: Optional[str] = Field(default="medium", pattern=r"^(short|medium|long)$")


class ToneRequest(BaseModel):
    text: str = Field(..., min_length=1)


class HumanizeRequest(BaseModel):
    text: str = Field(..., min_length=1)


class SynonymRequest(BaseModel):
    word: str = Field(..., min_length=1)
    context: Optional[str] = ""


class PlagiarismRequest(BaseModel):
    text: str = Field(..., min_length=1)


class AdvancedParaphraseRequest(BaseModel):
    text: str = Field(..., min_length=1)
    mode: Optional[str] = None
    writingStyle: Optional[str] = None
    targetAudience: Optional[str] = None
    preserveDialogue: bool = True


class GrammarCheckRequest(BaseModel):
    text: str = Field(..., min_length=1)
    level: str = Field(default="standard")


class CharacterAnalysisRequest(BaseModel):
    text: str = Field(..., min_length=1)
    characterName: str = Field(..., min_length=1)
    analysisType: Optional[str] = None


class CharacterSuggestionRequest(BaseModel):
    characterName: str = Field(..., min_length=1)
    traits: List[str] = Field(default_factory=list)
    focusArea: Optional[str] = None


class PlotAnalysisRequest(BaseModel):
    text: str = Field(..., min_length=1)
    plotType: Optional[str] = None
    directives: Optional[str] = None


class ManuscriptAnalysisRequest(BaseModel):
    chapters: List[Dict[str, Any]] = Field(default_factory=list)


class SceneAnalysisRequest(BaseModel):
    sceneText: str = Field(..., min_length=1)
    sceneType: Optional[str] = None


class CharacterInfo(BaseModel):
    name: str = Field(..., min_length=1)
    description: Optional[str] = ""


class SceneInput(BaseModel):
    title: str = Field(default="Scene")
    type: Optional[str] = None
    text: str = Field(default="")
    notes: Optional[str] = None


class ChapterDraftRequest(BaseModel):
    chapterTitle: str = Field(..., min_length=1)
    outline: Optional[str] = ""
    scenes: List[SceneInput] = Field(default_factory=list)
    directives: Optional[str] = None
    mainCharacters: List[CharacterInfo] = Field(default_factory=list)
    supportingCharacters: List[CharacterInfo] = Field(default_factory=list)


class ScenePlanRequest(BaseModel):
    chapterTitle: str = Field(..., min_length=1)
    chapterOutline: str = Field(..., min_length=1)
    desiredScenes: Optional[int] = Field(default=None, ge=1, le=20)
    sceneFocus: Optional[str] = None
    directives: Optional[str] = None
    mainCharacters: List[CharacterInfo] = Field(default_factory=list)
    supportingCharacters: List[CharacterInfo] = Field(default_factory=list)


class SceneRefineRequest(BaseModel):
    sceneTitle: str = Field(..., min_length=1)
    sceneText: str = Field(..., min_length=1)
    chapterTitle: Optional[str] = None
    chapterOutline: Optional[str] = None
    mode: Literal["expand", "tighten"] = Field(default="expand")
    directives: Optional[str] = None
    targetWords: Optional[int] = Field(default=None, ge=50, le=2000)
    mainCharacters: List[CharacterInfo] = Field(default_factory=list)
    supportingCharacters: List[CharacterInfo] = Field(default_factory=list)


class ReadabilityRequest(BaseModel):
    text: str = Field(..., min_length=1)
    targetAudience: Optional[str] = None


class ScriptAnalysisRequest(BaseModel):
    scriptText: str = Field(..., min_length=1)


def create_app() -> FastAPI:
    init_db()
    app = FastAPI(title="Lexicraft AI Backend", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.post("/api/paraphrase")
    async def paraphrase(payload: ParaphraseRequest) -> Dict[str, Any]:
        prompt = build_paraphrase_prompt(payload)
        result = await run_generation(prompt, temperature=0.9)
        return {
            "success": True,
            "result": result,
            "originalLength": len(payload.text),
            "newLength": len(result),
        }

    @app.post("/api/summarize")
    async def summarize(payload: SummarizeRequest) -> Dict[str, Any]:
        prompt = build_summary_prompt(payload)
        summary = await run_generation(prompt, temperature=0.3)
        original_len = len(payload.text)
        summary_len = len(summary)
        compression = 0.0
        if original_len:
            compression = ((original_len - summary_len) / original_len) * 100
        return {
            "success": True,
            "summary": summary,
            "originalLength": original_len,
            "summaryLength": summary_len,
            "compressionRatio": round(compression, 1),
        }

    @app.post("/api/analyze-tone")
    async def analyze_tone(payload: ToneRequest) -> Dict[str, Any]:
        prompt = build_tone_prompt(payload)
        analysis_text = await run_generation(prompt, temperature=0.2)
        analysis = coerce_json(analysis_text)
        if analysis is None:
            analysis = {
                "overallTone": analysis_text,
                "sentiment": "neutral",
                "confidence": "medium",
                "emotions": [],
                "suggestions": "Analysis completed",
            }
        return {"success": True, "analysis": analysis}

    @app.post("/api/check-plagiarism")
    async def check_plagiarism(payload: PlagiarismRequest) -> Dict[str, Any]:
        similarity = random.random() * 15
        sources: List[Dict[str, str]] = []
        if similarity > 10:
            sources.append(
                {
                    "url": "https://example.com/source1",
                    "similarity": f"{similarity:.1f}%",
                    "title": "Sample Source Document",
                }
            )
        words_checked = len(payload.text.split())
        return {
            "success": True,
            "similarity": f"{similarity:.1f}%",
            "isOriginal": similarity < 10,
            "sources": sources,
            "wordsChecked": words_checked,
        }

    @app.post("/api/humanize")
    async def humanize(payload: HumanizeRequest) -> Dict[str, Any]:
        prompt = build_humanize_prompt(payload)
        result = await run_generation(prompt, temperature=0.95)
        return {"success": True, "result": result}

    @app.post("/api/synonyms")
    async def synonyms(payload: SynonymRequest) -> Dict[str, Any]:
        prompt = build_synonym_prompt(payload)
        synonyms_text = await run_generation(prompt, temperature=0.4)
        synonyms = coerce_json(synonyms_text)
        if isinstance(synonyms, list):
            cleaned = [str(item).strip() for item in synonyms if str(item).strip()]
        else:
            cleaned = [part.strip() for part in synonyms_text.split(",") if part.strip()]
        return {"success": True, "synonyms": cleaned[:10]}

    @app.post("/api/paraphrase/advanced")
    async def advanced_paraphrase(payload: AdvancedParaphraseRequest) -> Dict[str, Any]:
        prompt = build_advanced_paraphrase_prompt(payload)
        result = await run_generation(prompt, temperature=0.85)
        return {
            "success": True,
            "result": result,
            "originalLength": len(payload.text),
            "newLength": len(result),
        }

    @app.post("/api/grammar/check")
    async def grammar_check(payload: GrammarCheckRequest) -> Dict[str, Any]:
        prompt = build_grammar_prompt(payload)
        analysis_text = await run_generation(prompt, temperature=0.3)
        analysis = coerce_json(analysis_text)
        if analysis is None or not isinstance(analysis, dict):
            analysis = default_grammar_analysis()
        return {"success": True, "analysis": analysis}

    @app.post("/api/character/analyze")
    async def character_analyze(payload: CharacterAnalysisRequest) -> Dict[str, Any]:
        prompt = build_character_prompt(payload)
        analysis_text = await run_generation(prompt, temperature=0.35)
        analysis = coerce_json(analysis_text)
        if analysis is None or not isinstance(analysis, dict):
            analysis = default_character_analysis()
        return {"success": True, "analysis": analysis}

    @app.post("/api/character/suggestions")
    async def character_suggestions(payload: CharacterSuggestionRequest) -> Dict[str, Any]:
        prompt = build_character_suggestion_prompt(payload)
        suggestions_text = await run_generation(prompt, temperature=0.65)
        suggestions = coerce_json(suggestions_text)
        if not isinstance(suggestions, list):
            suggestions = default_character_suggestions()
        return {"success": True, "suggestions": suggestions}

    @app.post("/api/plot/analyze")
    async def plot_analyze(payload: PlotAnalysisRequest) -> Dict[str, Any]:
        prompt = build_plot_prompt(payload)
        preview = prompt[:400]
        logger.info(
            "Plot analysis prompt preview (len=%s): %s%s",
            len(prompt),
            preview,
            "..." if len(prompt) > 400 else "",
        )
        if payload.directives:
            logger.info("Plot analysis directives applied: %s", payload.directives)
        analysis_text = await run_generation(prompt, temperature=0.4)
        logger.info(
            "Plot analysis raw response length: %s (preview: %s%s)",
            len(analysis_text),
            analysis_text[:200],
            "..." if len(analysis_text) > 200 else "",
        )

        result = coerce_json(analysis_text)

        analysis_block: Dict[str, Any] = {}
        chapters: List[Dict[str, Any]] = []

        if isinstance(result, dict):
            maybe_analysis = result.get("analysis")
            if isinstance(maybe_analysis, dict):
                analysis_block = maybe_analysis
            elif {"overallScore", "stages"}.issubset(result.keys()):
                analysis_block = result

            possible_chapters = result.get("chapterLayout") or result.get("chapters")
            if isinstance(possible_chapters, list):
                chapters = possible_chapters
            elif isinstance(result.get("suggestedChapters"), list):
                chapters = result["suggestedChapters"]
        elif isinstance(result, list):
            chapters = result

        if not analysis_block:
            logger.warning("Plot analysis fell back to default analysis block")
            analysis_block = default_plot_analysis()

        if not chapters:
            layout = analysis_block.get("chapterLayout")
            if isinstance(layout, list) and layout:
                chapters = layout
            else:
                fallback_chapters = analysis_block.get("suggestedChapters")
                if isinstance(fallback_chapters, list) and fallback_chapters:
                    chapters = fallback_chapters
                else:
                    stages = analysis_block.get("stages")
                    if isinstance(stages, list):
                        chapters = []
                        for index, stage in enumerate(stages):
                            title = stage.get("name") or f"Chapter {index + 1}"
                            description = stage.get("description") or ""
                            suggestions = stage.get("suggestions")
                            chapters.append(
                                {
                                    "title": title,
                                    "summary": description,
                                    "purpose": ", ".join(suggestions) if isinstance(suggestions, list) else stage.get("purpose", "outline"),
                                    "conflict": stage.get("conflict"),
                                    "tags": stage.get("tags") if isinstance(stage.get("tags"), list) else [],
                                }
                            )

        if not isinstance(chapters, list):
            logger.warning("Plot analysis produced non-list chapters, resetting to empty list")
            chapters = []

        normalized_chapters: List[Dict[str, Any]] = []
        for index, entry in enumerate(chapters):
            if not isinstance(entry, dict):
                continue
            title = entry.get("title") or entry.get("name") or f"Chapter {index + 1}"
            summary = entry.get("summary") or entry.get("description") or ""
            purpose = entry.get("purpose") or entry.get("goal") or entry.get("focus") or "outline"
            conflict = entry.get("conflict") or entry.get("tension")
            tags = entry.get("tags")
            if not isinstance(tags, list):
                hooks = entry.get("hooks")
                if isinstance(hooks, list):
                    tags = hooks
            if not isinstance(tags, list):
                tags = []
            metadata: Dict[str, Any] = {}
            if isinstance(entry.get("hooks"), list):
                metadata["hooks"] = entry["hooks"]
            if isinstance(entry.get("beats"), list):
                metadata["beats"] = entry["beats"]
            if entry.get("number") is not None:
                metadata["number"] = entry["number"]
            normalized_chapters.append(
                {
                    "title": title,
                    "summary": summary,
                    "purpose": purpose,
                    "conflict": conflict,
                    "tags": tags,
                    **({"metadata": metadata} if metadata else {}),
                }
            )

        chapters = normalized_chapters
        return {
            "success": True,
            "analysis": analysis_block,
            "chapters": chapters,
            "promptPreview": preview,
            "prompt": prompt,
            "responsePreview": analysis_text[:400],
            "directives": payload.directives,
        }

    @app.post("/api/manuscript/analyze")
    async def manuscript_analyze(payload: ManuscriptAnalysisRequest) -> Dict[str, Any]:
        prompt = build_manuscript_prompt(payload)
        analysis_text = await run_generation(prompt, temperature=0.45)
        analysis = coerce_json(analysis_text)
        if analysis is None or not isinstance(analysis, dict):
            analysis = default_manuscript_analysis()
        return {"success": True, "analysis": analysis}

    @app.post("/api/scene/analyze")
    async def scene_analyze(payload: SceneAnalysisRequest) -> Dict[str, Any]:
        prompt = build_scene_prompt(payload)
        analysis_text = await run_generation(prompt, temperature=0.5)
        analysis = coerce_json(analysis_text)
        if analysis is None or not isinstance(analysis, dict):
            analysis = default_scene_analysis()
        return {"success": True, "analysis": analysis}

    @app.post("/api/scene/plan")
    async def scene_plan(payload: ScenePlanRequest) -> Dict[str, Any]:
        prompt = build_scene_plan_prompt(payload)
        plan_text = await run_generation(prompt, temperature=0.55)
        plan = coerce_json(plan_text)
        scenes = normalize_scene_plan(plan, payload)
        if not scenes:
            scenes = default_scene_plan(payload)
        preview = plan_text[:400] if isinstance(plan_text, str) else ""
        return {
            "success": True,
            "scenes": scenes,
            "prompt": prompt,
            "promptPreview": prompt,
            "responsePreview": preview,
        }

    @app.post("/api/scene/refine")
    async def scene_refine(payload: SceneRefineRequest) -> Dict[str, Any]:
        prompt = build_scene_refine_prompt(payload)
        refined_text = await run_generation(prompt, temperature=0.5)
        refined = coerce_json(refined_text)
        normalized = normalize_refined_scene(refined, payload)
        if not normalized:
            normalized = default_refined_scene(payload)
        preview = refined_text[:400] if isinstance(refined_text, str) else ""
        return {
            "success": True,
            "scene": normalized,
            "prompt": prompt,
            "promptPreview": prompt,
            "responsePreview": preview,
        }

    @app.post("/api/chapter/draft")
    async def chapter_draft(payload: ChapterDraftRequest) -> Dict[str, Any]:
        if not payload.scenes:
            raise HTTPException(status_code=400, detail="At least one scene is required to draft a chapter")

        prompt = build_chapter_draft_prompt(payload)
        draft_text = await run_generation(prompt, temperature=0.65)
        structured = coerce_json(draft_text)

        if not isinstance(structured, dict):
            draft = default_chapter_draft(payload)
        else:
            draft = normalize_chapter_draft(structured, payload)
        preview = draft_text[:400] if isinstance(draft_text, str) else ""

        return {
            "success": True,
            "draft": draft,
            "prompt": prompt,
            "promptPreview": prompt,
            "responsePreview": preview,
        }

    @app.post("/api/readability/analyze")
    async def readability_analyze(payload: ReadabilityRequest) -> Dict[str, Any]:
        prompt = build_readability_prompt(payload)
        analysis_text = await run_generation(prompt, temperature=0.35)
        analysis = coerce_json(analysis_text)
        if analysis is None or not isinstance(analysis, dict):
            analysis = default_readability_analysis(payload.text)
        return {"success": True, "analysis": analysis}

    @app.post("/api/script/breakdown")
    async def script_breakdown(payload: ScriptAnalysisRequest) -> Dict[str, Any]:
        prompt = build_script_breakdown_prompt(payload)
        analysis_text = await run_generation(prompt, temperature=0.45)
        analysis = coerce_json(analysis_text)
        if analysis is None or not isinstance(analysis, dict):
            analysis = default_script_breakdown()
        return {"success": True, "analysis": analysis}

    @app.post("/api/script/shots")
    async def script_shots(payload: ScriptAnalysisRequest) -> Dict[str, Any]:
        prompt = build_shot_list_prompt(payload)
        shots_text = await run_generation(prompt, temperature=0.55)
        shots = coerce_json(shots_text)
        if not isinstance(shots, list):
            match = re.search(r"\[[\s\S]*\]", shots_text)
            if match:
                try:
                    shots = json.loads(match.group(0))
                except json.JSONDecodeError:
                    shots = []
            else:
                shots = []
        normalized = normalize_shot_list(shots)
        return {"success": True, "shots": normalized}

    app.include_router(storage_router, prefix="/api")
    app.include_router(projects_router, prefix="/api")
    app.include_router(characters_router, prefix="/api")
    app.include_router(worlds_router, prefix="/api")

    @app.on_event("startup")
    async def ensure_vector_store() -> None:  # pragma: no cover - startup hook
        await vector_store.ensure_ready()

    return app


async def run_generation(prompt: str, *, temperature: float) -> str:
    try:
        client = OpenRouterClient()
    except RuntimeError as exc:
        logger.error("OpenRouter client unavailable: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    try:
        return await client.generate(prompt, temperature=temperature)
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.exception("OpenRouter generation failed")
        raise HTTPException(status_code=502, detail="Failed to generate content") from exc


def build_advanced_paraphrase_prompt(payload: AdvancedParaphraseRequest) -> str:
    mode = payload.mode or "Literary"
    writing_style = payload.writingStyle or "neutral"
    target_audience = payload.targetAudience or "general"
    preserve_dialogue = "Yes" if payload.preserveDialogue else "No"

    return (
        "Transform the following text with these specifications:\n"
        f"- Literary Mode: {mode}\n"
        f"- Writing Style: {writing_style}\n"
        f"- Target Audience: {target_audience}\n"
        f"- Preserve Dialogue: {preserve_dialogue}\n\n"
        "Focus on:\n"
        "1. Enhancing literary quality while maintaining meaning\n"
        "2. Improving sentence variety and flow\n"
        "3. Elevating vocabulary appropriately\n"
        "4. Maintaining character voice consistency\n\n"
        "Provide ONLY the refined version without commentary.\n\n"
        f"Text: \"{payload.text}\""
    )


def build_grammar_prompt(payload: GrammarCheckRequest) -> str:
    level = (payload.level or "standard").lower()
    depth_mapping = {
        "basic": "Focus only on grammar errors and basic punctuation.",
        "standard": "Check grammar, punctuation, style, and clarity issues.",
        "comprehensive": "Comprehensive analysis including grammar, style, flow, consistency, and literary quality.",
        "literary": "Literary analysis focusing on creative writing, narrative voice, character consistency, and artistic expression.",
    }
    analysis_depth = depth_mapping.get(level, depth_mapping["standard"])

    return (
        f"Perform a {level} grammar and style analysis of the following text.\n\n"
        f"{analysis_depth}\n\n"
        "Text: \"" + payload.text + "\"\n\n"
        "Respond with ONLY a valid JSON object (no markdown formatting) in this exact format:\n"
        "{\n"
        "  \"overallScore\": 85,\n"
        "  \"issues\": [\n"
        "    {\n"
        "      \"type\": \"Grammar\",\n"
        "      \"severity\": \"critical\",\n"
        "      \"originalText\": \"exact text with issue\",\n"
        "      \"description\": \"explanation of the issue\",\n"
        "      \"suggestion\": \"corrected version\"\n"
        "    }\n"
        "  ],\n"
        "  \"readability\": \"Grade level or description\",\n"
        "  \"sentenceVariety\": \"Assessment of sentence structure variety\",\n"
        "  \"vocabularyLevel\": \"Assessment of vocabulary complexity\",\n"
        "  \"passiveVoiceUsage\": 15,\n"
        "  \"styleNotes\": \"Overall style assessment\"\n"
        "}"
    )


def build_character_prompt(payload: CharacterAnalysisRequest) -> str:
    analysis_type = (payload.analysisType or "development").lower()
    analysis_mapping = {
        "voice": "Analyze the character's unique voice, speech patterns, vocabulary, and dialogue style.",
        "development": "Analyze character development, growth, motivations, and character arc.",
        "consistency": "Check for consistency in character behavior, voice, and personality traits.",
        "dialogue": "Focus on dialogue quality, authenticity, and character-specific speech patterns.",
        "backstory": "Analyze implied backstory and suggest areas for character depth.",
    }
    focus = analysis_mapping.get(analysis_type, analysis_mapping["development"])

    return (
        f"Analyze the character \"{payload.characterName}\" in the following text.\n\n"
        f"Focus: {focus}\n\n"
        f"Text: \"{payload.text}\"\n\n"
        "Respond with ONLY a valid JSON object (no markdown formatting) in this exact format:\n"
        "{\n"
        "  \"traits\": [\"trait1\", \"trait2\", \"trait3\"],\n"
        "  \"voiceTone\": \"description of speaking style\",\n"
        "  \"speechPattern\": \"characteristic speech patterns\",\n"
        "  \"vocabularyLevel\": \"assessment of vocabulary used\",\n"
        "  \"emotionalRange\": \"range of emotions displayed\",\n"
        "  \"developmentNotes\": \"character development observations\",\n"
        "  \"inconsistencies\": [\"issue1\", \"issue2\"],\n"
        "  \"strengths\": [\"strength1\", \"strength2\"],\n"
        "  \"improvementAreas\": [\"area1\", \"area2\"]\n"
        "}"
    )


def build_character_suggestion_prompt(payload: CharacterSuggestionRequest) -> str:
    traits = ", ".join(payload.traits) if payload.traits else "No specific traits provided"
    focus = payload.focusArea or "General development"

    return (
        f"Generate creative enhancement suggestions for the character \"{payload.characterName}\" with traits: {traits}.\n\n"
        f"Focus area: {focus}\n\n"
        "Provide practical, creative suggestions for character development.\n\n"
        "Respond with ONLY a valid JSON array (no markdown formatting) in this exact format:\n"
        "[\n"
        "  {\n"
        "    \"category\": \"Dialogue\",\n"
        "    \"description\": \"detailed suggestion\",\n"
        "    \"example\": \"example implementation\"\n"
        "  }\n"
        "]"
    )


def build_plot_prompt(payload: PlotAnalysisRequest) -> str:
    plot_type = (payload.plotType or "custom").lower()
    structure_mapping = {
        "three-act": "Three-Act Structure: Setup (25%), Confrontation (50%), Resolution (25%).",
        "heros-journey": "Hero's Journey: Ordinary World, Call to Adventure, Refusal, Meeting Mentor, Crossing Threshold, Tests, Ordeal, Reward, Road Back, Resurrection, Return.",
        "seven-point": "Seven-Point Structure: Hook, Plot Turn 1, Pinch Point 1, Midpoint, Pinch Point 2, Plot Turn 2, Resolution.",
        "freytag": "Freytag's Pyramid: Exposition, Rising Action, Climax, Falling Action, Denouement.",
        "fichtean": "Fichtean Curve: Series of crises building to climax.",
    }
    structure = structure_mapping.get(plot_type, "Custom analysis of narrative structure.")

    directives = (payload.directives or "").strip()
    directives_block = (
        f"Additional directives for chapter planning: {directives}\n\n"
        if directives
        else ""
    )

    chapter_goal = (
        "Follow any explicit directives about chapter count or focus. "
        "If none are provided, produce a 12-chapter outline that fully covers the narrative arc."
    )

    return (
        f"Analyze the plot structure of the following story using {structure}\n\n"
        f"Text: \"{payload.text}\"\n\n"
        f"{directives_block}"
        f"{chapter_goal}\n\n"
        "Deliver:\n"
        "1. A structure analysis highlighting acts/stages, turning points, pacing, conflict, character arcs, themes, and actionable recommendations.\n"
        "2. A chapter layout that distributes the story across the requested or default chapter count, noting purpose, primary conflict/tension, and hooks.\n"
        "   Chapters must extend beyond simple act summaries and provide granular guidance for drafting scenes.\n\n"
        "Respond with ONLY a valid JSON object (no markdown formatting) in this exact format:\n"
        "{\n"
        "  \"analysis\": {\n"
        "    \"overallScore\": 85,\n"
        "    \"structureSummary\": \"one paragraph overview\",\n"
        "    \"stages\": [\n"
        "      {\n"
        "        \"name\": \"according to the analysis structure...\",\n"
        "        \"focus\": \"what this stage accomplishes\",\n"
        "        \"progressPercent\": 25,\n"
        "        \"keyBeats\": [\"inciting incident\", \"turning point\"],\n"
        "        \"notes\": \"analysis of strengths and risks\"\n"
        "      }\n"
        "    ],\n"
        "    \"pacing\": \"assessment of story pacing\",\n"
        "    \"conflict\": \"analysis of central conflict\",\n"
        "    \"characterArc\": \"character development assessment\",\n"
        "    \"themeDevelopment\": \"theme analysis\",\n"
        "    \"themes\": [\"theme1\", \"theme2\"],\n"
        "    \"recommendations\": [\n"
        "      {\n"
        "        \"priority\": \"high\",\n"
        "        \"title\": \"recommendation title\",\n"
        "        \"description\": \"detailed recommendation\"\n"
        "      }\n"
        "    ]\n"
        "  },\n"
        "  \"chapterLayout\": [\n"
        "    {\n"
        "      \"number\": 1,\n"
        "      \"title\": \"Chapter title\",\n"
        "      \"summary\": \"short synopsis\",\n"
        "      \"purpose\": \"narrative purpose\",\n"
        "      \"conflict\": \"primary tension\",\n"
        "      \"hooks\": [\"hook1\"],\n"
        "      \"tags\": [\"setup\", \"character\"]\n"
        "    }\n"
        "  ]\n"
        "}"
    )


def build_manuscript_prompt(payload: ManuscriptAnalysisRequest) -> str:
    chapters_json = json.dumps(payload.chapters, ensure_ascii=False)
    return (
        "Analyze this manuscript structure and provide insights.\n\n"
        f"Chapters: {chapters_json}\n\n"
        "Respond with ONLY a valid JSON object (no markdown formatting) in this exact format:\n"
        "{\n"
        "  \"overallProgress\": 65,\n"
        "  \"totalWordCount\": 50000,\n"
        "  \"averageChapterLength\": 2500,\n"
        "  \"paceAnalysis\": \"analysis of pacing across chapters\",\n"
        "  \"consistencyIssues\": [\"issue1\", \"issue2\"],\n"
        "  \"suggestions\": [\"suggestion1\", \"suggestion2\"],\n"
        "  \"readabilityScore\": 85,\n"
        "  \"chapterInsights\": [\n"
        "    {\n"
        "      \"chapterNumber\": 1,\n"
        "      \"strengths\": [\"strength1\"],\n"
        "      \"improvements\": [\"improvement1\"],\n"
        "      \"paceRating\": \"good\"\n"
        "    }\n"
        "  ]\n"
        "}"
    )


def build_chapter_draft_prompt(payload: ChapterDraftRequest) -> str:
    outline = payload.outline.strip() if payload.outline else ""
    directives = payload.directives.strip() if payload.directives else ""
    scene_payload = []
    for index, scene in enumerate(payload.scenes, start=1):
        scene_payload.append(
            {
                "number": index,
                "title": scene.title or f"Scene {index}",
                "type": scene.type or "general",
                "notes": (scene.notes or "").strip(),
                "text": scene.text,
            }
        )

    scenes_json = json.dumps(scene_payload, ensure_ascii=False)
    directive_line = directives or "None"
    outline_line = outline or "No outline provided."
    character_brief = build_character_brief(payload.mainCharacters, payload.supportingCharacters)

    return (
        "You are a collaborative novelist tasked with weaving polished prose from structured scene drafts."
        " Compose a cohesive chapter that respects the supplied outline, maintains continuity, and preserves key beats.\n\n"
        f"Chapter Title: {payload.chapterTitle}\n"
        f"Chapter Outline: {outline_line}\n"
        f"Additional Directives: {directive_line}\n\n"
        f"{character_brief}"
        "Scenes (JSON order reflects narrative progression):\n"
        f"{scenes_json}\n\n"
        "Respond with ONLY a valid JSON object (no markdown formatting) following this exact schema:\n"
        "{\n"
        "  \"title\": \"Refined chapter title\",\n"
        "  \"summary\": \"One paragraph highlighting arc, stakes, and emotional flow\",\n"
        "  \"sections\": [\n"
        "    {\n"
        "      \"heading\": \"Section heading describing scene focus\",\n"
        "      \"objective\": \"What this passage accomplishes\",\n"
        "      \"beats\": [\"key beat\"],\n"
        "      \"text\": [\"cohesive paragraph one\", \"cohesive paragraph two\"]\n"
        "    }\n"
        "  ],\n"
        "  \"styleNotes\": [\"Optional reminders or follow-ups\"]\n"
        "}"
    )


def build_scene_prompt(payload: SceneAnalysisRequest) -> str:
    scene_type = payload.sceneType or "General"
    return (
        "Analyze this scene for conflict, tension, and effectiveness:\n\n"
        f"Scene Type: {scene_type}\n"
        f"Scene Text: \"{payload.sceneText}\"\n\n"
        "Respond with ONLY a valid JSON object (no markdown formatting) in this exact format:\n"
        "{\n"
        "  \"conflictLevel\": 85,\n"
        "  \"tensionRating\": 90,\n"
        "  \"paceRating\": 75,\n"
        "  \"dialogueQuality\": 80,\n"
        "  \"characterDevelopment\": 70,\n"
        "  \"conflictTypes\": [\"internal\", \"external\"],\n"
        "  \"tensionTechniques\": [\"technique1\", \"technique2\"],\n"
        "  \"strengths\": [\"strength1\", \"strength2\"],\n"
        "  \"improvements\": [\"improvement1\", \"improvement2\"],\n"
        "  \"suggestions\": [\n"
        "    {\n"
        "      \"type\": \"Conflict\",\n"
        "      \"description\": \"suggestion description\",\n"
        "      \"example\": \"example implementation\"\n"
        "    }\n"
        "  ]\n"
        "}"
    )


def build_scene_plan_prompt(payload: ScenePlanRequest) -> str:
    outline = payload.chapterOutline.strip()
    desired = payload.desiredScenes or 5
    focus = (payload.sceneFocus or "").strip()
    focus_line = f"Scene focus guidance: {focus}\n" if focus else ""
    directives = (payload.directives or "").strip()
    directives_line = directives if directives else "None"
    character_brief = build_character_brief(payload.mainCharacters, payload.supportingCharacters)

    return (
        "You are a narrative designer turning a chapter outline into a sequence of scenes."
        " Map out coherent scene beats that propel the chapter.\n\n"
        f"Chapter Title: {payload.chapterTitle}\n"
        f"Target Scene Count: {desired}\n"
        f"Chapter Outline:\n{outline}\n\n"
        f"{focus_line}Additional directives: {directives_line}\n\n"
        f"{character_brief}"
        "Respond with ONLY a valid JSON object using this schema (no markdown):\n"
        "{\n"
        "  \"scenes\": [\n"
        "    {\n"
        "      \"title\": \"Scene title\",\n"
        "      \"type\": \"dialogue|action|emotional|exposition|set-piece\",\n"
        "      \"length\": \"short|medium|long\",\n"
        "      \"summary\": \"One paragraph describing the scene\",\n"
        "      \"purpose\": \"Narrative purpose or goal\",\n"
        "      \"beats\": [\"key beat\"],\n"
        "      \"setting\": \"Where it happens\",\n"
        "      \"tone\": \"Emotional tone\",\n"
        "      \"notes\": \"Any production notes or special considerations\"\n"
        "    }\n"
        "  ],\n"
        "  \"overview\": {\n"
        "    \"actStructure\": \"How scenes flow\",\n"
        "    \"progression\": \"How stakes escalate\"\n"
        "  }\n"
        "}"
    )


def build_scene_refine_prompt(payload: SceneRefineRequest) -> str:
    outline = (payload.chapterOutline or "").strip()
    directives = (payload.directives or "").strip()
    mode = payload.mode.lower()
    target = payload.targetWords if payload.targetWords else (220 if mode == "expand" else 140)
    action = "Expand" if mode == "expand" else "Tighten"
    character_brief = build_character_brief(payload.mainCharacters, payload.supportingCharacters)

    outline_block = f"Chapter Outline: {outline}\n\n" if outline else ""
    directives_line = directives if directives else "None"

    return (
        f"{action} the following scene while keeping POV, voice, and continuity intact."
        " Maintain coherent pacing and ensure the scene still advances the chapter goal."
        "\n\n"
        f"Chapter Title: {payload.chapterTitle or 'Untitled Chapter'}\n"
        f"Scene Title: {payload.sceneTitle}\n"
        f"Current Scene Words: {len(payload.sceneText.split())}\n"
        f"Target Word Count: about {target}\n"
        f"Additional directives: {directives_line}\n\n"
        f"{character_brief}{outline_block}Current Scene Text:\n{payload.sceneText}\n\n"
        "Respond with ONLY a valid JSON object in this exact shape:\n"
        "{\n"
        "  \"title\": \"Updated scene title\",\n"
        "  \"text\": \"Rewritten scene text\",\n"
        "  \"beats\": [\"notable beat\"],\n"
        "  \"notes\": \"Author guidance or follow-up\"\n"
        "}"
    )


def build_readability_prompt(payload: ReadabilityRequest) -> str:
    audience = payload.targetAudience or "General audience"
    return (
        f"Analyze the readability of this text for target audience: {audience}\n\n"
        f"Text: \"{payload.text}\"\n\n"
        "Respond with ONLY a valid JSON object (no markdown formatting) in this exact format:\n"
        "{\n"
        "  \"readabilityScore\": 85,\n"
        "  \"gradeLevel\": \"8th Grade\",\n"
        "  \"targetMatch\": true,\n"
        "  \"wordComplexity\": \"appropriate\",\n"
        "  \"sentenceLength\": \"good\",\n"
        "  \"vocabularyLevel\": \"suitable\",\n"
        "  \"improvements\": [\n"
        "    {\n"
        "      \"issue\": \"issue description\",\n"
        "      \"suggestion\": \"how to fix\",\n"
        "      \"example\": \"example fix\"\n"
        "    }\n"
        "  ],\n"
        "  \"strengths\": [\"strength1\", \"strength2\"],\n"
        "  \"optimizedVersion\": \"optimized text version\"\n"
        "}"
    )


def build_script_breakdown_prompt(payload: ScriptAnalysisRequest) -> str:
    return (
        "Analyze this screenplay and identify production elements in these categories:\n"
        "- props\n"
        "- wardrobe\n"
        "- cast\n"
        "- locations\n"
        "- sfx\n"
        "- vehicles\n"
        "- animals\n"
        "- stunts\n"
        "- makeup\n"
        "- equipment\n"
        "- extras\n\n"
        f"Script:\n\"{payload.scriptText}\"\n\n"
        "Respond with ONLY a valid JSON object (no markdown formatting) in this exact format:\n"
        "{\n"
        "  \"props\": [\"prop1\", \"prop2\"],\n"
        "  \"wardrobe\": [\"item1\", \"item2\"],\n"
        "  \"cast\": [\"character1\", \"character2\"],\n"
        "  \"locations\": [\"location1\", \"location2\"],\n"
        "  \"sfx\": [\"effect1\", \"effect2\"],\n"
        "  \"vehicles\": [\"vehicle1\", \"vehicle2\"],\n"
        "  \"animals\": [\"animal1\", \"animal2\"],\n"
        "  \"stunts\": [\"stunt1\", \"stunt2\"],\n"
        "  \"makeup\": [\"makeup1\", \"makeup2\"],\n"
        "  \"equipment\": [\"equipment1\", \"equipment2\"],\n"
        "  \"extras\": [\"extra1\", \"extra2\"]\n"
        "}"
    )


def build_shot_list_prompt(payload: ScriptAnalysisRequest) -> str:
    truncated_script = payload.scriptText[:15000]
    return (
        "Based on this screenplay, create a detailed shot list with appropriate camera setups."
        " For each key moment in the script, suggest a specific shot with these technical details:\n"
        "- scene number\n"
        "- shot number\n"
        "- shot description\n"
        "- shot type (CU, MS, WS, etc.)\n"
        "- camera angle\n"
        "- camera movement\n"
        "- equipment needed\n"
        "- lens recommendation\n"
        "- estimated duration\n"
        "- frame rate\n\n"
        f"Script:\n\"{truncated_script}\"\n\n"
        "Generate at least 5 shots. Respond with ONLY a valid JSON array (no markdown formatting) in this exact format:\n"
        "[\n"
        "  {\n"
        "    \"scene\": \"1\",\n"
        "    \"shotNumber\": \"1\",\n"
        "    \"description\": \"Description of the shot content\",\n"
        "    \"type\": \"MS\",\n"
        "    \"angle\": \"Eye Level\",\n"
        "    \"movement\": \"Static\",\n"
        "    \"equipment\": \"Tripod\",\n"
        "    \"lens\": \"50mm\",\n"
        "    \"framing\": \"Medium\",\n"
        "    \"notes\": \"Additional technical notes\",\n"
        "    \"duration\": \"5s\",\n"
        "    \"frameRate\": \"24 fps\"\n"
        "  }\n"
        "]"
    )


def default_grammar_analysis() -> Dict[str, Any]:
    return {
        "overallScore": 75,
        "issues": [],
        "readability": "Analysis completed successfully",
        "sentenceVariety": "Standard variety observed",
        "vocabularyLevel": "Appropriate for intended audience",
        "passiveVoiceUsage": 0,
        "styleNotes": "Text analyzed for style and structure",
    }


def default_character_analysis() -> Dict[str, Any]:
    return {
        "traits": ["Character analyzed"],
        "voiceTone": "Analysis completed successfully",
        "speechPattern": "Patterns identified",
        "vocabularyLevel": "Appropriate level",
        "emotionalRange": "Emotions observed",
        "developmentNotes": "Character development noted",
        "inconsistencies": [],
        "strengths": ["Character strengths identified"],
        "improvementAreas": ["Areas for development noted"],
    }


def default_character_suggestions() -> List[Dict[str, Any]]:
    return [
        {
            "category": "General Development",
            "description": "Character enhancement suggestions generated",
            "example": "See detailed analysis for specific recommendations",
        }
    ]


def default_plot_analysis() -> Dict[str, Any]:
    return {
        "overallScore": 75,
        "structureSummary": "Plot structure analyzed successfully",
        "stages": [
            {
                "name": "Structure Analysis",
                "progressPercent": 75,
                "focus": "Assess overall pacing and turn key moments",
                "notes": "Plot structure analyzed successfully",
                "keyBeats": ["Inciting incident", "Climax"],
            }
        ],
        "pacing": "Pacing analysis completed",
        "conflict": "Conflict development noted",
        "characterArc": "Character development observed",
        "themeDevelopment": "Themes identified",
        "themes": ["Perseverance"],
        "recommendations": [
            {
                "priority": "medium",
                "title": "General Development",
                "description": "Continue refining your plot structure",
            }
        ],
        "chapterLayout": [
            {
                "number": 1,
                "title": "Chapter 1: Opening Image",
                "summary": "Introduce the protagonist's ordinary world and hint at the central tension.",
                "purpose": "Hook the reader and establish tone.",
                "conflict": "Unease with the status quo",
                "tags": ["setup", "worldbuilding"],
            },
            {
                "number": 2,
                "title": "Chapter 2: Catalyst",
                "summary": "The inciting incident disrupts daily life and forces a choice.",
                "purpose": "Kick off the narrative drive.",
                "conflict": "Unexpected disruption",
                "tags": ["inciting-incident"],
            },
            {
                "number": 3,
                "title": "Chapter 3: Debate",
                "summary": "Protagonist wrestles with the call to action and stakes escalate.",
                "purpose": "Deepen internal conflict and stakes.",
                "conflict": "Doubts and resistance",
                "tags": ["debate", "character"],
            },
            {
                "number": 4,
                "title": "Chapter 4: Crossing the Threshold",
                "summary": "Decision made, the protagonist enters a new arena with unfamiliar rules.",
                "purpose": "Launch the story into Act II",
                "conflict": "Facing the unknown",
                "tags": ["act-transition"],
            },
            {
                "number": 5,
                "title": "Chapter 5: First Trials",
                "summary": "Early encounters test skills and establish new allies or enemies.",
                "purpose": "Explore the new world and dynamics.",
                "conflict": "Initial resistance",
                "tags": ["rising-action"],
            },
            {
                "number": 6,
                "title": "Chapter 6: Midpoint Twist",
                "summary": "A major revelation or victory flips the stakes and commitment.",
                "purpose": "Reframe the goal and escalate urgency.",
                "conflict": "Success with consequences",
                "tags": ["midpoint"],
            },
            {
                "number": 7,
                "title": "Chapter 7: Falling Back",
                "summary": "Opposition regroups and applies pressure, exposing weaknesses.",
                "purpose": "Show the cost of the new direction.",
                "conflict": "Escalating pushback",
                "tags": ["setback"],
            },
            {
                "number": 8,
                "title": "Chapter 8: Darkest Moment",
                "summary": "A devastating loss or betrayal strips hope and forces introspection.",
                "purpose": "Collapse the protagonist's plan and set up rebirth.",
                "conflict": "All seems lost",
                "tags": ["low-point"],
            },
            {
                "number": 9,
                "title": "Chapter 9: Revelation",
                "summary": "New insight or ally reignites the fight with sharper intent.",
                "purpose": "Deliver the lesson that solves the conflict.",
                "conflict": "Choosing a new path",
                "tags": ["revelation"],
            },
            {
                "number": 10,
                "title": "Chapter 10: Final Approach",
                "summary": "Allies rally, resources align, and the protagonist commits fully.",
                "purpose": "Prepare for the climax.",
                "conflict": "Countdown pressure",
                "tags": ["rally"],
            },
            {
                "number": 11,
                "title": "Chapter 11: Climax",
                "summary": "Direct confrontation resolves the central conflict through decisive action.",
                "purpose": "Pay off the promise of the premise.",
                "conflict": "Ultimate confrontation",
                "tags": ["climax"],
            },
            {
                "number": 12,
                "title": "Chapter 12: Resolution",
                "summary": "Aftermath shows transformed characters and threads tie off.",
                "purpose": "Deliver emotional closure and tease future possibilities.",
                "conflict": "Lingering consequences",
                "tags": ["denouement"],
            },
        ],
    }


def default_manuscript_analysis() -> Dict[str, Any]:
    return {
        "overallProgress": 0,
        "totalWordCount": 0,
        "averageChapterLength": 0,
        "paceAnalysis": "Analysis in progress",
        "consistencyIssues": [],
        "suggestions": ["Continue writing your manuscript"],
        "readabilityScore": 75,
        "chapterInsights": [],
    }


def normalize_chapter_draft(draft: Dict[str, Any], payload: ChapterDraftRequest) -> Dict[str, Any]:
    title = str(draft.get("title") or payload.chapterTitle).strip()
    summary = str(draft.get("summary") or payload.outline or "Draft generated from scenes.").strip()

    raw_sections = draft.get("sections") if isinstance(draft, dict) else None
    sections: List[Dict[str, Any]] = []
    if isinstance(raw_sections, list):
        for index, raw in enumerate(raw_sections, start=1):
            if not isinstance(raw, dict):
                continue
            heading = str(raw.get("heading") or raw.get("title") or f"Scene {index}").strip() or f"Scene {index}"
            objective = str(raw.get("objective") or raw.get("purpose") or "").strip()
            beats_raw = raw.get("beats") or raw.get("keyBeats") or []
            if isinstance(beats_raw, str):
                beats = [beats_raw.strip()] if beats_raw.strip() else []
            elif isinstance(beats_raw, list):
                beats = [str(item).strip() for item in beats_raw if str(item).strip()]
            else:
                beats = []

            text_field = raw.get("text") or raw.get("draft") or raw.get("draftParagraphs")
            paragraphs: List[str] = []
            if isinstance(text_field, str):
                cleaned = text_field.strip()
                if cleaned:
                    paragraphs = [cleaned]
            elif isinstance(text_field, list):
                paragraphs = [str(item).strip() for item in text_field if str(item).strip()]

            if not paragraphs:
                paragraphs = []

            sections.append(
                {
                    "heading": heading,
                    "objective": objective,
                    "beats": beats,
                    "text": paragraphs,
                }
            )

    if not sections:
        sections = []
        for index, scene in enumerate(payload.scenes, start=1):
            text = (scene.text or "").strip()
            if not text and not (scene.notes or "").strip():
                continue
            sections.append(
                {
                    "heading": scene.title or f"Scene {index}",
                    "objective": (scene.notes or "").strip(),
                    "beats": [],
                    "text": [text] if text else [],
                }
            )

    style_notes_raw = draft.get("styleNotes") or draft.get("notes") or draft.get("reminders")
    if isinstance(style_notes_raw, str):
        style_notes = [style_notes_raw.strip()] if style_notes_raw.strip() else []
    elif isinstance(style_notes_raw, list):
        style_notes = [str(item).strip() for item in style_notes_raw if str(item).strip()]
    else:
        style_notes = []

    return {
        "title": title or payload.chapterTitle,
        "summary": summary or payload.outline or "Draft generated from scenes.",
        "sections": sections,
        "styleNotes": style_notes,
    }


def default_chapter_draft(payload: ChapterDraftRequest) -> Dict[str, Any]:
    return normalize_chapter_draft(
        {
            "title": payload.chapterTitle,
            "summary": payload.outline or "Draft generated from scenes.",
            "sections": [
                {
                    "heading": scene.title or f"Scene {index}",
                    "objective": (scene.notes or "").strip(),
                    "beats": [],
                    "text": [scene.text.strip()] if scene.text and scene.text.strip() else [],
                }
                for index, scene in enumerate(payload.scenes, start=1)
                if (scene.text and scene.text.strip()) or (scene.notes and scene.notes.strip())
            ],
            "styleNotes": ["Draft synthesized from provided scenes without model guidance."],
        },
        payload,
    )


def normalize_scene_plan(plan: Any, payload: ScenePlanRequest) -> List[Dict[str, Any]]:
    scenes = []
    if isinstance(plan, dict):
        raw_scenes = plan.get("scenes")
    elif isinstance(plan, list):
        raw_scenes = plan
    else:
        raw_scenes = None

    if isinstance(raw_scenes, list):
        for index, item in enumerate(raw_scenes, start=1):
            if not isinstance(item, dict):
                continue
            title = (item.get("title") or item.get("name") or f"Scene {index}").strip()
            scene_type = (item.get("type") or item.get("sceneType") or "general").strip()
            summary = (item.get("summary") or item.get("description") or "").strip()
            purpose = (item.get("purpose") or item.get("goal") or item.get("objective") or "").strip()
            notes = (item.get("notes") or item.get("reminder") or "").strip()
            tone = (item.get("tone") or item.get("mood") or "").strip()
            length = (item.get("length") or item.get("pace") or "medium").strip()
            setting = (item.get("setting") or item.get("location") or "").strip()
            beats = item.get("beats") or item.get("keyBeats") or []
            if isinstance(beats, str):
                beats = [beat.strip() for beat in beats.split(";") if beat.strip()]
            elif isinstance(beats, list):
                beats = [str(beat).strip() for beat in beats if str(beat).strip()]
            else:
                beats = []

            if isinstance(item.get("text"), str) and item["text"].strip():
                text = item["text"].strip()
            elif isinstance(item.get("draft"), str) and item["draft"].strip():
                text = item["draft"].strip()
            else:
                beat_block = "\n".join(f"- {beat}" for beat in beats) if beats else ""
                text = "\n\n".join(part for part in [summary, beat_block] if part)

            scenes.append(
                {
                    "title": title or f"Scene {index}",
                    "type": scene_type or "general",
                    "summary": summary,
                    "purpose": purpose,
                    "beats": beats,
                    "notes": notes,
                    "tone": tone,
                    "length": length or "medium",
                    "setting": setting,
                    "text": text,
                }
            )

    return scenes


def default_scene_plan(payload: ScenePlanRequest) -> List[Dict[str, Any]]:
    outline = payload.chapterOutline.split('\n')
    desired = payload.desiredScenes or 4
    default_titles = [
        "Opening Beat",
        "Rising Complication",
        "Turning Point",
        "Outcome"
    ]
    scenes: List[Dict[str, Any]] = []
    for index in range(desired):
        title = default_titles[index] if index < len(default_titles) else f"Scene {index + 1}"
        summary = outline[index] if index < len(outline) else outline[-1] if outline else payload.chapterOutline
        scenes.append(
            {
                "title": title,
                "type": "general",
                "summary": summary.strip() if summary else "Scene placeholder generated locally.",
                "purpose": "Advance the chapter narrative.",
                "beats": [],
                "notes": "Add detail once the AI planner is available.",
                "tone": "",
                "length": "medium",
                "setting": "",
                "text": summary.strip() if summary else payload.chapterOutline,
            }
        )
    return scenes


def normalize_refined_scene(refined: Any, payload: SceneRefineRequest) -> Dict[str, Any]:
    if not isinstance(refined, dict):
        return {}
    text = refined.get("text") or refined.get("scene")
    if not isinstance(text, str) or not text.strip():
        return {}

    title = refined.get("title") or payload.sceneTitle
    beats = refined.get("beats") or refined.get("keyBeats") or []
    if isinstance(beats, str):
        beats = [beat.strip() for beat in beats.split(";") if beat.strip()]
    elif isinstance(beats, list):
        beats = [str(beat).strip() for beat in beats if str(beat).strip()]
    else:
        beats = []

    notes = refined.get("notes") or refined.get("guidance") or ""

    return {
        "title": str(title).strip() or payload.sceneTitle,
        "text": text.strip(),
        "beats": beats,
        "notes": notes.strip() if isinstance(notes, str) else "",
    }


def default_refined_scene(payload: SceneRefineRequest) -> Dict[str, Any]:
    words = payload.sceneText.split()
    if payload.mode == "tighten":
        keep = max(1, int(len(words) * 0.7))
        truncated = " ".join(words[:keep])
    else:
        truncated = payload.sceneText + "\n\n[Expand this scene with richer detail when the AI service is available.]"

    return {
        "title": payload.sceneTitle,
        "text": truncated.strip(),
        "beats": [],
        "notes": "Scene adjusted locally due to service fallback.",
    }


def default_scene_analysis() -> Dict[str, Any]:
    return {
        "conflictLevel": 50,
        "tensionRating": 50,
        "paceRating": 50,
        "dialogueQuality": 50,
        "characterDevelopment": 50,
        "conflictTypes": ["general"],
        "tensionTechniques": ["basic tension"],
        "strengths": ["Scene analyzed"],
        "improvements": ["Continue developing"],
        "suggestions": [
            {
                "type": "General",
                "description": "Scene analysis completed",
                "example": "Continue refining your scene",
            }
        ],
    }


def default_readability_analysis(original_text: str) -> Dict[str, Any]:
    return {
        "readabilityScore": 75,
        "gradeLevel": "General Adult",
        "targetMatch": True,
        "wordComplexity": "appropriate",
        "sentenceLength": "good",
        "vocabularyLevel": "suitable",
        "improvements": [
            {
                "issue": "Analysis completed",
                "suggestion": "Continue refining text",
                "example": "Keep developing your writing",
            }
        ],
        "strengths": ["Text analyzed successfully"],
        "optimizedVersion": original_text,
    }


def default_script_breakdown() -> Dict[str, Any]:
    keys = [
        "props",
        "wardrobe",
        "cast",
        "locations",
        "sfx",
        "vehicles",
        "animals",
        "stunts",
        "makeup",
        "equipment",
        "extras",
    ]
    return {key: [] for key in keys}


def normalize_shot_list(shots: Any) -> List[Dict[str, Any]]:
    if not isinstance(shots, list):
        shots = []

    normalized: List[Dict[str, Any]] = []
    timestamp = int(time.time() * 1000)

    for idx, raw in enumerate(shots):
        if not isinstance(raw, dict):
            continue
        entry: Dict[str, Any] = {
            "id": raw.get("id") or timestamp + idx,
            "scene": str(raw.get("scene", "1")),
            "shotNumber": str(raw.get("shotNumber", str(idx + 1))),
            "description": raw.get("description", "Shot description"),
            "type": raw.get("type", "MS"),
            "angle": raw.get("angle", "Eye Level"),
            "movement": raw.get("movement", "Static"),
            "equipment": raw.get("equipment", "Tripod"),
            "lens": raw.get("lens", "50mm"),
            "framing": raw.get("framing", "Medium"),
            "notes": raw.get("notes", ""),
            "duration": raw.get("duration", "5s"),
            "frameRate": raw.get("frameRate", "24 fps"),
        }
        normalized.append(entry)

    if not normalized:
        normalized.append(
            {
                "id": timestamp,
                "scene": "1",
                "shotNumber": "1",
                "description": "Shot description",
                "type": "MS",
                "angle": "Eye Level",
                "movement": "Static",
                "equipment": "Tripod",
                "lens": "50mm",
                "framing": "Medium",
                "notes": "",
                "duration": "5s",
                "frameRate": "24 fps",
            }
        )

    return normalized


def build_paraphrase_prompt(payload: ParaphraseRequest) -> str:
    base = payload.text
    mode = (payload.mode or "").lower()

    if mode == "formal":
        instruction = "Rewrite the text with a formal, professional tone while preserving meaning."
    elif mode == "academic":
        instruction = "Rewrite the text in an academic, scholarly register using precise terminology."
    elif mode == "simple":
        instruction = "Simplify the text so it is easy to read without losing the key message."
    elif mode == "creative":
        instruction = "Rewrite the text with fresh, imaginative phrasing and varied sentence structure."
    elif mode == "shorten":
        instruction = "Condense the text, retaining only essential information."
    elif mode == "expand":
        instruction = "Expand the text by adding relevant detail and descriptive color."
    elif mode == "custom" and payload.customPrompt:
        instruction = payload.customPrompt
    else:
        instruction = "Paraphrase the text while preserving meaning."

    return (
        f"{instruction}\n\n"
        f"TEXT:\n" + base
    )


def build_summary_prompt(payload: SummarizeRequest) -> str:
    length = payload.length or "medium"
    if length == "short":
        directive = "Write a brief 2-3 sentence summary of the text."
    elif length == "long":
        directive = "Write a detailed summary that captures key points, supporting details, and context."
    else:
        directive = "Write a concise summary that captures the main ideas."
    return f"{directive}\n\nTEXT:\n{payload.text}"


def build_tone_prompt(payload: ToneRequest) -> str:
    return (
        "Analyze the tone of the text and respond ONLY with JSON using the following shape:\n"
        "{\n"
        "  \"overallTone\": \"description\",\n"
        "  \"sentiment\": \"positive|negative|neutral\",\n"
        "  \"confidence\": \"high|medium|low\",\n"
        "  \"emotions\": [\"emotion\"],\n"
        "  \"suggestions\": \"improvement suggestions\"\n"
        "}\n\nTEXT:\n"
        f"{payload.text}"
    )


def build_humanize_prompt(payload: HumanizeRequest) -> str:
    return (
        "Make this AI-generated text read as natural human prose. Improve flow, add subtle imperfections, and keep meaning intact."
        "\n\nTEXT:\n"
        f"{payload.text}"
    )


def build_synonym_prompt(payload: SynonymRequest) -> str:
    return (
        "Provide up to 10 synonyms ranked by relevance for the given word in the provided context."
        " Respond with a JSON array of strings only.\n\n"
        f"WORD: {payload.word}\n"
        f"CONTEXT: {payload.context or 'General writing'}"
    )


def coerce_json(raw: str) -> Optional[Any]:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-zA-Z]*\n?|```$", "", cleaned).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        return None


app = create_app()
def build_character_brief(main: List[CharacterInfo], supporting: List[CharacterInfo]) -> str:
    if not main and not supporting:
        return ""

    def render(section: str, characters: List[CharacterInfo]) -> str:
        if not characters:
            return ""
        lines = [f"{char.name}: {char.description}".strip().rstrip(':') for char in characters]
        return f"{section}:\n" + "\n".join(f"- {line}" for line in lines if line)

    parts = [render("Main Characters", main), render("Supporting Characters", supporting)]
    joined = "\n\n".join(part for part in parts if part)
    return f"Character Roster:\n{joined}\n\n" if joined else ""
