export const screeningPromptVersion = "dropx-evidence-fit-v1";
export const screeningModel = process.env.RECRUITMENT_SCREENING_MODEL?.trim() || "openai/gpt-5.6-sol";

const protectedLine = /^(age|date of birth|dob|gender|sex|marital status|religion|caste|race|ethnicity|nationality|disability|photo)\s*[:\-]/i;

export function redactResumeForScreening(value: string, candidateName?: string | null) {
  let result = String(value ?? "").normalize("NFKC");
  result = result
    .split(/\r?\n/)
    .filter((line) => !protectedLine.test(line.trim()))
    .join("\n")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email redacted]")
    .replace(/(?:\+?91[\s-]?)?[6-9]\d(?:[\s-]?\d){8}/g, "[phone redacted]")
    .replace(/\b(?:19|20)\d{2}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])\b/g, "[date redacted]");
  const name = String(candidateName ?? "").trim();
  if (name.length >= 3) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(escaped, "gi"), "[candidate name redacted]");
  }
  return result.replace(/\n{4,}/g, "\n\n\n").trim().slice(0, 30_000);
}

export type ScreeningResult = {
  fitScore: number;
  recommendation: "strong_review" | "review" | "needs_evidence";
  summary: string;
  mustHaveMatches: Array<{ requirement: string; status: "met" | "partial" | "not_evidenced"; evidence: string }>;
  strengths: string[];
  gaps: string[];
  evidence: string[];
  interviewQuestions: string[];
  confidence: number;
  inputTokens: number | null;
  outputTokens: number | null;
  model: string;
};

const screeningSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    fitScore: { type: "integer", minimum: 0, maximum: 100 },
    recommendation: { type: "string", enum: ["strong_review", "review", "needs_evidence"] },
    summary: { type: "string" },
    mustHaveMatches: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          requirement: { type: "string" },
          status: { type: "string", enum: ["met", "partial", "not_evidenced"] },
          evidence: { type: "string" }
        },
        required: ["requirement", "status", "evidence"]
      }
    },
    strengths: { type: "array", items: { type: "string" } },
    gaps: { type: "array", items: { type: "string" } },
    evidence: { type: "array", items: { type: "string" } },
    interviewQuestions: { type: "array", items: { type: "string" } },
    confidence: { type: "number", minimum: 0, maximum: 1 }
  },
  required: ["fitScore", "recommendation", "summary", "mustHaveMatches", "strengths", "gaps", "evidence", "interviewQuestions", "confidence"]
} as const;

function gatewayCredential() {
  return process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim() || "";
}

function boundedStrings(value: unknown, limit = 12) {
  return Array.isArray(value)
    ? value.map(String).map((item) => item.trim().slice(0, 500)).filter(Boolean).slice(0, limit)
    : [];
}

export async function analyzeCandidateFit(input: {
  jobDescription: string;
  resumeText: string;
  candidateName?: string | null;
}) : Promise<ScreeningResult> {
  const credential = gatewayCredential();
  if (!credential) {
    throw new Error("AI Gateway is not enabled for this deployment. Enable it in Vercel project settings and try again.");
  }
  const jobDescription = String(input.jobDescription ?? "").trim().slice(0, 30_000);
  const resumeText = redactResumeForScreening(input.resumeText, input.candidateName);
  if (jobDescription.length < 80) throw new Error("The job description needs more detail before fit analysis can run.");
  if (resumeText.length < 80) throw new Error("The resume does not contain enough readable role evidence.");

  const response = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: screeningModel,
      stream: false,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: "You are a hiring evidence assistant. Compare only job-related evidence in the resume with the supplied job description. Never infer or use age, gender, religion, caste, ethnicity, marital status, disability, nationality, health, appearance, family status or other protected traits. Do not reject or select anyone. Missing evidence means not evidenced, not unqualified. Give concise evidence that a human recruiter can verify."
        },
        {
          role: "user",
          content: `JOB DESCRIPTION\n${jobDescription}\n\nANONYMISED RESUME\n${resumeText}\n\nReturn a review aid only. fitScore is evidence coverage, not a hiring decision.`
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "dropx_candidate_fit", strict: true, schema: screeningSchema }
      }
    })
  });
  const payload = await response.json() as any;
  if (!response.ok) {
    const code = response.status === 402 ? "AI budget is exhausted."
      : response.status === 429 ? "AI screening is temporarily rate limited."
      : response.status >= 500 ? "AI screening is temporarily unavailable."
      : payload?.error?.message || "AI screening could not be completed.";
    throw new Error(code);
  }
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI screening returned no structured result.");
  const parsed = JSON.parse(content) as Record<string, unknown>;
  const score = Math.max(0, Math.min(100, Math.round(Number(parsed.fitScore) || 0)));
  const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
  const recommendation = ["strong_review", "review", "needs_evidence"].includes(String(parsed.recommendation))
    ? String(parsed.recommendation) as ScreeningResult["recommendation"] : "needs_evidence";
  const mustHaveMatches = Array.isArray(parsed.mustHaveMatches) ? parsed.mustHaveMatches.slice(0, 30).map((item: any) => ({
    requirement: String(item?.requirement ?? "").trim().slice(0, 500),
    status: ["met", "partial", "not_evidenced"].includes(String(item?.status)) ? item.status : "not_evidenced",
    evidence: String(item?.evidence ?? "").trim().slice(0, 800)
  })).filter((item) => item.requirement) : [];
  return {
    fitScore: score,
    recommendation,
    summary: String(parsed.summary ?? "").trim().slice(0, 2000),
    mustHaveMatches,
    strengths: boundedStrings(parsed.strengths),
    gaps: boundedStrings(parsed.gaps),
    evidence: boundedStrings(parsed.evidence, 20),
    interviewQuestions: boundedStrings(parsed.interviewQuestions, 10),
    confidence,
    inputTokens: Number.isFinite(Number(payload?.usage?.prompt_tokens)) ? Number(payload.usage.prompt_tokens) : null,
    outputTokens: Number.isFinite(Number(payload?.usage?.completion_tokens)) ? Number(payload.usage.completion_tokens) : null,
    model: String(payload?.model || screeningModel)
  };
}

