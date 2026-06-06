export interface CompanyReconData {
    name: string;
    ticker?: string;
    industry?: string;
    description: string;
    vibe?: string;
    business_model?: string;
    competitors?: string[];
}

export interface MatchData {
    matched_entities: string[];
    headline: string;
    reasoning: string;
    prompt?: string;
}

export interface QuestionItem {
    id: string;
    question: string;
    category: 'Behavioral' | 'Knowledge' | 'Coding' | 'Case Study' | 'Mock Scenario' | 'System Design' | 'Product Management' | 'Design' | 'Data & Analytics' | 'General' | string;
    difficulty?: 'junior' | 'mid' | 'senior' | 'staff+' | 'director+';
    topics?: string[];
    answerFramework?: 'PEDALS' | 'CIRCLES' | 'CAP' | 'TRADE-OFFS' | 'RICE' | 'AARRR' | 'HEART' | 'BML' | 'ROOT-CAUSE';
    keyPoints?: string[];
    commonPitfalls?: string[];
    framework?: string;
}

export interface SystemDesignData {
    questions: QuestionItem[];
    curatedCount: number;
    aiGeneratedCount: number;
    roleType?: string;
}

export interface QuestionsData {
    questions: QuestionItem[];
}

export interface ReverseQuestionsData {
    reverse_questions: (string | { type: string; question: string })[];
}

export interface StarStory {
    id: string;
    title: string;
    type?: 'star' | 'blob';
    content?: string; // For unstructured text blobs
    situation?: string;
    task?: string;
    action?: string;
    result?: string;
    deleted?: boolean;
    tags?: string[];
    importance?: 'high' | 'medium' | 'low';
    question?: string;
}

export interface SourceItem {
    id: string;
    type: 'text' | 'url' | 'file';
    title: string;
    content: string;
    created_at?: string;
    visibility?: 'private' | 'public';
    user_id?: string;
}

export interface TechnicalData {
    questions: {
        topic: string;
        question: string;
        context_clue: string;
    }[];
}

export interface CodingChallenge {
    title: string;
    description: string;
    examples: string[];
    constraints: string[];
    starter_code: string;
    solution_approach?: string;
}

export interface ProviderConfig {
    provider: 'openrouter' | 'groq';
    apiKey: string;
    model: string;
}

export interface AnswerCritique {
    // The heart-moment: a human reaction, not a report card.
    reaction: string;          // 2-3 sentences, second person — the moment they feel SEEN. Names the real, often-unnoticed strength.
    the_one_thing: string;     // The single highest-leverage change, said like a mentor leaning in.
    say_it_like_this: string;  // Their answer rewritten in their own voice, so they can hear how good it could sound.
    encouragement: string;     // One honest, earned line that leaves them believing they can do this.
    score: number;             // 1-10 — kept for tracking/progress, intentionally NOT the lead of the UI.
    scoreLabel: string;        // A gentle word: "Getting there", "Solid", "Strong", "Ready".
    // Retained (optional) for back-compat — no longer the primary surface.
    strengths?: string[];
    weaknesses?: string[];
    missing_nuances?: string[];
    improved_version?: string;
    tone_analysis?: string;
}
