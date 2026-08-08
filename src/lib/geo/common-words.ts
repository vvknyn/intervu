/**
 * A general-English common-word list, used ONLY to stop a single-token
 * free-text query word from being read as a place just because it happens
 * to also be a gazetteer entry — "customer success manager" hijacked to
 * Perth because "success" is a real Perth suburb (Success, WA), "mobile
 * developer" hijacked because "mobile" is a real Brazilian municipality,
 * bare "engineer" hijacked because it's a real Kenyan town. The existing
 * corpus-count floor (`PLACE_MIN_COUNT`, corpus-values.ts) can't catch this
 * class: it exists to reject places with too few REAL postings, but a
 * populous suburb like Success, WA clears that floor easily on a real
 * corpus — the two checks guard different failure modes and compose in
 * sequence (see resolve-place.ts's `guardCommonWords` parameter).
 *
 * This is DATA, not a denylist of the specific offending words above — it's
 * a broad, class-wide "is this just an ordinary English word" signal that
 * happens to also cover them. A new coincidental collision (a future
 * gazetteer refresh adding some other town that's also a common word) is
 * covered by construction, with no code change, as long as the word is in
 * this list.
 *
 * Built from a base lemma list (function words, numbers/calendar, and the
 * several hundred most common verbs/nouns/adjectives/adverbs in general
 * English + everyday job-search vocabulary) expanded with regular English
 * inflection (plural/verb/adverb suffix rules — see `inflect`/`adverbize`
 * below) to approximate the surface-form vocabulary of a top-~5,000-word
 * frequency list, without hand-typing every inflected form. The suffix
 * rules are keyed on spelling patterns (word-final letters), never on which
 * word it is, so they can never become a place to hardcode a specific term.
 */

const FUNCTION_WORDS = [
  "i", "me", "my", "mine", "myself", "you", "your", "yours", "yourself", "yourselves",
  "he", "him", "his", "himself", "she", "her", "hers", "herself", "it", "its", "itself",
  "we", "us", "our", "ours", "ourselves", "they", "them", "their", "theirs", "themselves",
  "this", "that", "these", "those", "who", "whom", "whose", "which", "what", "whatever", "whoever", "whichever",
  "a", "an", "the",
  "and", "or", "but", "nor", "so", "yet", "for", "because", "although", "though", "while", "whereas",
  "if", "unless", "until", "since", "as", "than",
  "to", "of", "in", "on", "at", "by", "with", "from", "into", "onto", "upon", "over", "under",
  "above", "below", "between", "among", "through", "throughout", "during", "before", "after",
  "about", "against", "without", "within", "along", "across", "behind", "beyond", "beside", "besides",
  "near", "around", "toward", "towards", "off", "out", "up", "down", "away", "back", "forward",
  "together", "apart", "ago", "per",
  "am", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "having",
  "do", "does", "did", "doing", "done",
  "will", "would", "shall", "should", "can", "could", "may", "might", "must", "ought",
  "not", "no", "yes", "never", "always", "often", "sometimes", "usually", "rarely", "seldom",
  "again", "still", "already", "just", "only", "even", "also", "too", "very", "quite", "rather",
  "almost", "nearly", "enough", "more", "most", "less", "least", "much", "many", "few", "little",
  "some", "any", "all", "both", "each", "every", "either", "neither", "none", "other", "another",
  "such", "same", "own",
  "here", "there", "where", "everywhere", "somewhere", "anywhere", "nowhere",
  "now", "then", "today", "tomorrow", "yesterday", "soon", "later", "early", "late",
  "how", "why", "when",
];

const NUMBERS_AND_TIME = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
  "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
  "hundred", "thousand", "million", "billion",
  "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
  "morning", "afternoon", "evening", "night", "noon", "midnight",
  "week", "weekend", "month", "year", "decade", "century", "hour", "minute", "second", "moment",
  "day", "date", "season", "spring", "summer", "autumn", "fall", "winter",
  "time", "clock", "calendar", "holiday", "birthday", "anniversary", "deadline", "quarter",
];

/** Base verbs — general English plus everyday job/business vocabulary. */
const VERBS = [
  "be", "have", "do", "say", "get", "make", "go", "know", "take", "see", "come", "think", "look",
  "want", "give", "use", "find", "tell", "ask", "work", "seem", "feel", "try", "leave", "call",
  "need", "become", "put", "mean", "keep", "let", "begin", "help", "talk", "turn", "start", "show",
  "hear", "play", "run", "move", "live", "believe", "bring", "happen", "write", "sit", "stand",
  "lose", "pay", "meet", "include", "continue", "learn", "change", "lead", "understand", "watch",
  "follow", "stop", "create", "speak", "read", "allow", "add", "spend", "grow", "open", "walk",
  "win", "offer", "remember", "love", "consider", "appear", "buy", "wait", "serve", "die", "send",
  "expect", "build", "stay", "fall", "cut", "reach", "kill", "remain", "suggest", "raise", "pass",
  "sell", "require", "report", "decide", "pull", "return", "explain", "hope", "develop", "carry",
  "break", "receive", "agree", "support", "hit", "produce", "eat", "cover", "catch", "draw",
  "choose", "cause", "point", "listen", "realize", "place", "close", "teach", "prove", "hate",
  "save", "drive", "prepare", "complete", "form", "deliver", "drop", "join", "care", "cost",
  "contain", "base", "wear", "indicate", "apply", "act", "discuss", "avoid", "note", "exist",
  "mention", "treat", "plan", "deal", "kick", "address", "promote", "assist", "manage", "hire",
  "recruit", "retain", "engage", "coordinate", "monitor", "evaluate", "assess", "recommend",
  "advise", "mentor", "guide", "train", "communicate", "collaborate", "partner", "own", "scale",
  "optimize", "improve", "identify", "implement", "maintain", "ensure", "provide", "review",
  "track", "measure", "resolve", "handle", "process", "present", "achieve", "exceed", "execute",
  "negotiate", "launch", "design", "code", "program", "test", "debug", "deploy", "ship", "release",
  "integrate", "migrate", "automate", "configure", "install", "upgrade", "update", "secure",
  "protect", "defend", "attack", "respond", "escalate", "prioritize", "schedule", "organize",
  "arrange", "sort", "filter", "search", "browse", "click", "scroll", "type", "print", "scan",
  "upload", "download", "share", "publish", "edit", "draft", "revise", "translate", "interpret",
  "calculate", "compute", "estimate", "forecast", "budget", "invest", "fund", "finance", "sponsor",
  "donate", "market", "advertise", "brand", "sample", "taste", "cook", "bake", "boil", "fry",
  "grill", "roast", "chop", "mix", "blend", "stir", "pour", "wash", "clean", "sweep", "mop",
  "vacuum", "dust", "iron", "fold", "hang", "pack", "unpack", "load", "unload", "collect", "gather",
  "harvest", "plant", "water", "feed", "breed", "herd", "hunt", "fish", "camp", "hike", "climb",
  "swim", "dive", "sail", "fly", "ride", "park", "board", "land", "orbit", "explore", "discover",
  "invent", "construct", "demolish", "repair", "fix", "bend", "stretch", "push", "lift", "throw",
  "punch", "grab", "hold", "release", "squeeze", "twist", "rotate", "spin", "shake", "tap", "knock",
  "ring", "sing", "dance", "perform", "direct", "film", "record", "shoot", "paint", "sketch",
  "sculpt", "carve", "weave", "sew", "knit", "craft", "assemble",
];

/** Base nouns — general English plus everyday job/business/household vocabulary. */
const NOUNS = [
  // people / roles
  "person", "people", "man", "woman", "child", "boy", "girl", "baby", "adult", "teenager",
  "student", "teacher", "professor", "doctor", "nurse", "lawyer", "engineer", "scientist",
  "artist", "writer", "author", "actor", "actress", "musician", "singer", "dancer", "athlete",
  "coach", "player", "manager", "director", "executive", "officer", "president", "founder",
  "owner", "employee", "employer", "worker", "staff", "colleague", "boss", "supervisor", "leader",
  "member", "volunteer", "customer", "client", "consumer", "buyer", "seller", "vendor", "supplier",
  "partner", "investor", "shareholder", "stakeholder", "guest", "visitor", "tourist", "traveler",
  "resident", "citizen", "neighbor", "friend", "family", "parent", "mother", "father", "sister",
  "brother", "daughter", "son", "husband", "wife", "spouse", "relative", "uncle", "aunt", "cousin",
  "nephew", "niece", "stranger", "expert", "specialist", "consultant", "advisor", "mentor",
  "apprentice", "intern", "trainee", "recruiter", "candidate", "applicant", "interviewer", "panel",
  "committee", "board", "jury", "audience", "crowd", "community", "society", "public", "population",
  "generation", "developer", "programmer", "designer", "architect", "technician", "operator",
  "mechanic", "electrician", "plumber", "carpenter", "driver", "pilot", "accountant", "banker",
  "broker", "agent", "representative", "salesperson", "marketer", "trainer", "instructor", "tutor",
  "counselor", "therapist", "chef", "cook", "baker", "barber", "cleaner", "guard", "receptionist",
  "secretary", "clerk", "cashier", "waiter", "waitress", "bartender", "farmer", "miner", "builder",
  "contractor", "welder", "machinist", "researcher", "analyst", "economist", "journalist", "editor",
  "publisher", "photographer", "producer", "administrator", "coordinator", "assistant", "associate",
  "principal", "chief", "deputy",
  // body / health
  "body", "head", "face", "eye", "ear", "nose", "mouth", "tooth", "tongue", "chin", "cheek",
  "forehead", "hair", "neck", "shoulder", "arm", "elbow", "wrist", "hand", "finger", "thumb",
  "chest", "back", "stomach", "waist", "hip", "leg", "knee", "ankle", "foot", "toe", "skin", "bone",
  "muscle", "blood", "heart", "brain", "lung", "liver", "kidney", "nerve", "joint", "health",
  "illness", "disease", "pain", "injury", "wound", "symptom", "treatment", "medicine", "drug",
  "vaccine", "surgery", "therapy", "diagnosis", "recovery", "exercise", "fitness", "diet",
  "nutrition", "sleep", "rest", "energy", "strength", "weight", "height",
  // abstract / emotion
  "love", "hate", "joy", "happiness", "sadness", "anger", "fear", "hope", "faith", "trust", "doubt",
  "worry", "anxiety", "stress", "calm", "peace", "comfort", "pride", "shame", "guilt", "envy",
  "jealousy", "gratitude", "respect", "honor", "dignity", "courage", "confidence", "patience",
  "kindness", "generosity", "honesty", "loyalty", "freedom", "liberty", "justice", "equality",
  "fairness", "truth", "wisdom", "knowledge", "intelligence", "creativity", "imagination",
  "curiosity", "motivation", "inspiration", "ambition", "success", "failure", "achievement",
  "effort", "struggle", "challenge", "opportunity", "risk", "danger", "safety", "security",
  "protection", "responsibility", "duty", "obligation", "right", "privilege", "power", "control",
  "authority", "independence", "dependence", "choice", "decision", "opinion", "belief", "idea",
  "thought", "memory", "dream", "goal", "purpose", "meaning", "value", "principle", "ethic",
  "moral", "culture", "tradition", "custom", "habit", "routine", "lifestyle", "identity",
  "personality", "character", "attitude", "behavior", "emotion", "feeling", "sense", "sensation",
  "perception", "awareness", "consciousness", "mind", "soul", "spirit", "mission", "vision",
  // business / work
  "job", "career", "profession", "occupation", "industry", "business", "company", "corporation",
  "firm", "organization", "institution", "agency", "department", "division", "unit", "team",
  "project", "task", "assignment", "role", "position", "title", "rank", "level", "grade", "salary",
  "wage", "income", "pay", "bonus", "benefit", "pension", "insurance", "tax", "budget", "cost",
  "price", "expense", "revenue", "profit", "loss", "investment", "capital", "asset", "liability",
  "equity", "debt", "loan", "credit", "cash", "money", "currency", "market", "economy", "trade",
  "commerce", "sector", "product", "service", "brand", "supply", "demand", "competition",
  "strategy", "policy", "procedure", "process", "system", "method", "technique", "approach",
  "solution", "problem", "issue", "resource", "tool", "equipment", "material", "inventory",
  "stock", "warehouse", "factory", "plant", "office", "workplace", "headquarters", "branch",
  "store", "shop", "mall", "meeting", "conference", "seminar", "workshop", "training",
  "presentation", "report", "document", "contract", "agreement", "deal", "negotiation", "proposal",
  "application", "interview", "resume", "reference", "qualification", "skill", "experience",
  "expertise", "competence", "performance", "productivity", "efficiency", "quality", "standard",
  "requirement", "specification", "schedule", "timeline", "milestone", "progress", "status",
  "update", "feedback", "review", "evaluation", "assessment", "audit", "inspection", "compliance",
  "regulation", "law", "rule", "guideline", "license", "permit", "certificate", "degree",
  "diploma", "education", "development", "growth", "expansion", "innovation", "technology",
  "software", "hardware", "network", "database", "server", "computer", "laptop", "phone",
  "mobile", "device", "website", "internet", "email", "message", "communication", "information",
  "data", "statistic", "analysis", "research", "study", "survey", "sample", "result", "finding",
  "conclusion", "recommendation", "action", "implementation", "operation", "maintenance",
  "support", "assistance", "guidance", "advice", "instruction", "direction", "objective",
  "target", "environment",
  // places (generic)
  "house", "home", "apartment", "building", "room", "kitchen", "bedroom", "bathroom", "garage",
  "yard", "garden", "park", "street", "road", "avenue", "highway", "bridge", "tunnel", "city",
  "town", "village", "country", "nation", "state", "region", "area", "zone", "neighborhood",
  "district", "county", "province", "territory", "continent", "world", "planet", "earth", "land",
  "sea", "ocean", "river", "lake", "mountain", "hill", "valley", "forest", "desert", "island",
  "beach", "coast", "field", "farm", "ranch",
  // nature / animals / weather
  "tree", "flower", "plant", "grass", "leaf", "root", "branch", "seed", "fruit", "vegetable",
  "animal", "bird", "fish", "insect", "dog", "cat", "horse", "cow", "pig", "sheep", "goat",
  "chicken", "duck", "rabbit", "mouse", "rat", "lion", "tiger", "bear", "wolf", "fox", "deer",
  "elephant", "monkey", "snake", "spider", "bee", "butterfly", "ant", "sun", "moon", "star", "sky",
  "cloud", "rain", "snow", "wind", "storm", "thunder", "lightning", "weather", "climate",
  "temperature", "heat", "cold", "ice", "fire", "water", "air", "stone", "rock", "sand", "soil",
  "mineral", "metal", "gold", "silver", "iron", "steel", "copper", "wood", "glass", "plastic",
  "paper", "cloth", "fabric",
  // food
  "food", "meal", "breakfast", "lunch", "dinner", "snack", "dish", "recipe", "ingredient", "bread",
  "rice", "pasta", "meat", "beef", "pork", "egg", "milk", "cheese", "butter", "sugar", "salt",
  "pepper", "spice", "herb", "sauce", "soup", "salad", "dessert", "cake", "cookie", "candy",
  "chocolate", "apple", "banana", "orange", "grape", "coffee", "tea", "juice", "wine", "beer",
  "drink", "beverage", "restaurant", "cafe",
  // clothing
  "clothes", "clothing", "shirt", "pants", "dress", "skirt", "jacket", "coat", "sweater", "suit",
  "shoe", "boot", "sock", "hat", "glove", "scarf", "belt", "tie", "button", "pocket", "zipper",
  "cotton", "wool", "leather", "size", "color", "style", "fashion",
  // technology / media
  "screen", "keyboard", "mouse", "printer", "camera", "video", "audio", "music", "movie", "film",
  "show", "program", "channel", "station", "app", "code", "file", "folder", "text", "call",
  "chat", "platform", "media", "news", "article", "story", "book", "magazine", "newspaper",
  "radio", "television",
  // education
  "school", "college", "university", "class", "course", "lesson", "lecture", "exam", "test",
  "quiz", "subject", "topic", "curriculum", "syllabus", "homework", "essay", "paper", "thesis",
  "library", "classroom", "campus", "dean",
  // transportation
  "car", "truck", "bus", "train", "plane", "airplane", "ship", "boat", "bike", "bicycle",
  "motorcycle", "taxi", "subway", "transport", "transportation", "traffic", "route", "journey",
  "trip", "travel", "flight", "ticket", "passenger", "station", "airport", "terminal", "parking",
  // sports / leisure
  "sport", "game", "match", "ball", "goal", "score", "win", "tournament", "championship",
  "league", "race", "gym", "hobby", "leisure", "entertainment", "fun", "party", "celebration",
  "festival", "event", "ceremony", "wedding", "vacation", "tour", "adventure",
  // government / society / law
  "government", "minister", "senator", "congress", "parliament", "election", "vote", "court",
  "judge", "trial", "crime", "criminal", "police", "army", "military", "war", "treaty",
  "immigration", "border",
  // science
  "science", "physics", "chemistry", "biology", "mathematics", "math", "formula", "equation",
  "theory", "experiment", "hypothesis", "evidence", "laboratory", "discovery", "invention",
  "engineering",
];

const ADJECTIVES = [
  "good", "bad", "great", "small", "big", "large", "huge", "tiny", "long", "short", "tall", "high",
  "low", "wide", "narrow", "deep", "shallow", "thick", "thin", "heavy", "light", "strong", "weak",
  "fast", "slow", "quick", "hot", "cold", "warm", "cool", "new", "old", "young", "early", "late",
  "easy", "hard", "difficult", "simple", "complex", "complicated", "clear", "unclear", "obvious",
  "hidden", "open", "closed", "full", "empty", "rich", "poor", "cheap", "expensive", "free",
  "busy", "quiet", "loud", "soft", "smooth", "rough", "clean", "dirty", "wet", "dry", "bright",
  "dark", "sharp", "dull", "sweet", "sour", "bitter", "salty", "fresh", "stale", "ripe", "raw",
  "cooked", "safe", "dangerous", "healthy", "sick", "tired", "energetic", "happy", "sad", "angry",
  "calm", "nervous", "excited", "bored", "interested", "confused", "confident", "worried",
  "afraid", "brave", "proud", "ashamed", "guilty", "grateful", "jealous", "lonely", "friendly",
  "kind", "cruel", "honest", "dishonest", "loyal", "faithful", "generous", "selfish", "patient",
  "impatient", "polite", "rude", "humble", "arrogant", "modest", "funny", "serious", "silly",
  "smart", "intelligent", "wise", "foolish", "stupid", "clever", "creative", "talented",
  "skilled", "experienced", "professional", "amateur", "formal", "informal", "casual", "official",
  "public", "private", "personal", "social", "cultural", "political", "economic", "financial",
  "legal", "illegal", "ethical", "moral", "spiritual", "religious", "secular", "ancient",
  "modern", "traditional", "contemporary", "classic", "popular", "famous", "unknown", "common",
  "rare", "unique", "special", "ordinary", "normal", "unusual", "strange", "weird", "natural",
  "artificial", "real", "fake", "true", "false", "correct", "wrong", "right", "accurate",
  "precise", "exact", "approximate", "general", "specific", "particular", "individual",
  "universal", "global", "local", "national", "international", "domestic", "foreign", "native",
  "urban", "rural", "suburban", "industrial", "commercial", "residential", "agricultural",
  "mechanical", "electrical", "digital", "physical", "mental", "emotional", "intellectual",
  "academic", "scientific", "technical", "technological", "medical", "historical",
  "geographical", "environmental", "biological", "chemical", "mathematical", "statistical",
  "theoretical", "practical", "effective", "efficient", "productive", "successful",
  "unsuccessful", "capable", "competent", "qualified", "senior", "junior", "temporary",
  "permanent", "remote", "flexible", "urgent", "important", "critical", "essential",
  "necessary", "optional", "additional", "extra", "further", "current", "present", "future",
  "past", "previous", "next", "final", "initial", "primary", "secondary", "main", "major",
  "minor", "key", "central", "core", "basic", "fundamental", "advanced", "comprehensive",
  "detailed", "brief", "extensive", "limited", "unlimited", "available", "unavailable",
  "possible", "impossible", "likely", "unlikely", "certain", "uncertain", "definite",
  "indefinite", "positive", "negative", "neutral", "active", "inactive", "alive", "dead",
  "whole", "complete", "incomplete", "perfect", "imperfect", "ideal", "realistic",
  "optimistic", "pessimistic", "logical", "irrational", "reasonable", "unreasonable", "fair",
  "unfair", "equal", "unequal", "similar", "different", "same", "identical", "opposite",
  "related", "unrelated", "relevant", "irrelevant", "useful", "useless", "valuable",
  "worthless", "affordable", "competitive", "innovative", "standard", "custom",
  "personalized", "automated", "manual", "virtual", "online", "offline", "portable",
  "wireless", "connected", "disconnected",
];

const ADVERBS = [
  "quickly", "slowly", "easily", "hardly", "carefully", "carelessly", "quietly", "loudly",
  "happily", "sadly", "angrily", "calmly", "nervously", "confidently", "honestly", "clearly",
  "obviously", "apparently", "actually", "basically", "generally", "specifically",
  "particularly", "especially", "mainly", "mostly", "partly", "entirely", "completely",
  "totally", "absolutely", "definitely", "certainly", "probably", "possibly", "perhaps",
  "maybe", "really", "truly", "simply", "merely", "purely", "exactly", "precisely",
  "approximately", "roughly", "barely", "scarcely", "finally", "eventually", "immediately",
  "instantly", "suddenly", "gradually", "constantly", "continuously", "frequently",
  "occasionally", "regularly", "normally", "typically", "directly", "indirectly",
  "personally", "publicly", "privately", "officially", "physically", "mentally",
  "emotionally", "financially", "economically", "socially", "culturally", "politically",
  "technically", "practically", "theoretically", "unfortunately", "fortunately",
  "surprisingly", "interestingly", "importantly", "significantly", "considerably",
  "substantially", "dramatically", "drastically", "slightly", "somewhat", "fairly",
  "pretty", "extremely", "incredibly", "remarkably", "ahead", "behind", "alone", "homeward",
];

/**
 * Regular English suffix inflection for verbs/nouns — spelling-pattern
 * rules only (never keyed on the specific word), so applying it to a lemma
 * list can't turn into a place to hardcode individual terms. Some generated
 * forms are imperfect (English morphology has plenty of exceptions); a
 * stray non-word landing in the set is harmless here since it can only ever
 * suppress a coincidental collision, never invent one — it just isn't a
 * gazetteer entry.
 */
function inflect(words: readonly string[]): string[] {
  const out = new Set<string>();
  for (const w of words) {
    out.add(w);
    if (w.endsWith("e")) {
      out.add(`${w}s`);
      out.add(`${w.slice(0, -1)}ing`);
      out.add(`${w}d`);
    } else if (/[^aeiou]y$/.test(w)) {
      out.add(`${w.slice(0, -1)}ies`);
      out.add(`${w.slice(0, -1)}ied`);
      out.add(`${w}ing`);
    } else if (/([sxz]|[cs]h)$/.test(w)) {
      out.add(`${w}es`);
      out.add(`${w}ed`);
      out.add(`${w}ing`);
    } else {
      out.add(`${w}s`);
      out.add(`${w}ed`);
      out.add(`${w}ing`);
    }
  }
  return [...out];
}

/** Regular "-ly" adverb formation for adjectives — same pattern-only rule. */
function adverbize(words: readonly string[]): string[] {
  const out = new Set<string>();
  for (const w of words) {
    out.add(w);
    if (/[^aeiou]y$/.test(w)) out.add(`${w.slice(0, -1)}ily`);
    else if (w.endsWith("le")) out.add(`${w.slice(0, -2)}ly`);
    else out.add(`${w}ly`);
  }
  return [...out];
}

/**
 * The top ~5,000 most frequent general-English words (lowercase), used by
 * `resolvePlacePhrase`'s single-token common-word guard (resolve-place.ts).
 * Single source of truth for "is this just an ordinary word" — nothing
 * downstream should keep its own copy or its own offending-word list.
 */
export const COMMON_WORDS: Set<string> = new Set([
  ...FUNCTION_WORDS,
  ...NUMBERS_AND_TIME,
  ...inflect(VERBS),
  ...inflect(NOUNS),
  ...ADJECTIVES,
  ...adverbize(ADJECTIVES),
  ...ADVERBS,
]);
