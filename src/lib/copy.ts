// Centralized copy — one file for all personality-driven messaging.
// Keeps tone consistent, makes it easy to tweak wording across the app.

export function pickRandom<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

// ---------------------------------------------------------------------------
// Loading messages (shown during analysis in DashboardContainer)
// ---------------------------------------------------------------------------
export const LOADING_MESSAGES = [
    "Stalking their Glassdoor reviews... for research purposes",
    "Teaching the AI to think like a recruiter...",
    "Calculating your odds... just kidding, you've got this",
    "Brewing a strategy stronger than your morning coffee...",
    "Reading between the lines of that job description...",
    "Translating corporate jargon into actual questions...",
    "Assembling your secret weapon... almost there",
    "Asking ChatGPT what ChatGPT would ask you...",
    "Cross-referencing your skills with their wish list...",
    "Reverse-engineering the hiring manager's brain...",
    "Turning 'synergy' into actual interview questions...",
    "Scanning for red flags so you don't have to...",
    "Making your experience sound as impressive as it actually is...",
    "Converting buzzwords into things humans actually say...",
    "Pretending we're not also nervous for you...",
];

// ---------------------------------------------------------------------------
// Loading tips (LoadingState.tsx — rotating tips while waiting)
// ---------------------------------------------------------------------------
export const LOADING_TIPS = [
    "Good things take time. Great interview prep takes ~15 seconds.",
    "Fun fact: the average interviewer decides in the first 7 minutes. You'll be ready for all of them.",
    "While you wait: take a deep breath. You're already ahead of 90% of candidates who don't prep.",
    "Pro tip: re-read the job description one more time before your interview. It always helps.",
    "Did you know? Interviewers love follow-up questions. We'll help you prepare some.",
    "The person who got your dream job last time? They prepped. Just saying.",
    "Your future self is going to send us a thank-you note for this.",
    "Hot take: 'Where do you see yourself in 5 years?' is still a thing. We'll help.",
    "Fun fact: saying 'um' in an interview burns 0.3 calories. Preparation burns less.",
    "The Wi-Fi is holding up. Your interview answers will too.",
    "Somewhere, a recruiter just sighed at an unprepared candidate. Not you though.",
    "This loading screen is shorter than the awkward silence after a bad answer.",
];

// ---------------------------------------------------------------------------
// Empty state — dashboard home (EmptyState.tsx)
// ---------------------------------------------------------------------------
export const EMPTY_DASHBOARD = {
    headings: [
        "Your interviewer is prepping. Are you?",
        "That dream job won't interview itself",
        "Somewhere, a recruiter just opened your resume...",
        "Ready when you are. (No pressure.)",
    ],
    subtext:
        "Enter a company, role, and interview round above to get personalized strategies, questions, and insights.",
};

// ---------------------------------------------------------------------------
// Empty state — applications list (ApplicationList.tsx)
// ---------------------------------------------------------------------------
export const EMPTY_APPLICATIONS = {
    headings: [
        "No applications yet — the job market won't know what hit it",
        "Your tracker is empty but your potential isn't",
    ],
    subtext: "Add your first job application to start tracking your progress.",
};

// ---------------------------------------------------------------------------
// Empty state — stories (StoryBankRecipeWizard.tsx)
// ---------------------------------------------------------------------------
export const EMPTY_STORIES = {
    prompt: "Think of a time you led a project, solved a hard problem, or made something better than it was before.",
};

// ---------------------------------------------------------------------------
// Recipe card subtitles (recipes-config.ts)
// ---------------------------------------------------------------------------
export const RECIPE_SUBTITLES: Record<string, string> = {
    setup: "Two minutes to greatness. We timed it.",
    "track-application": "Because 'I'll remember it' never works",
    "tailor-resume": "One resume doesn't fit all. Shocking, right?",
    "prepare-interview": "Questions, strategies, and a confidence boost",
    "add-sources": "Feed the AI your intel. It gets smarter.",
    "build-stories": "Your greatest hits, STAR-formatted",
};

// ---------------------------------------------------------------------------
// Search hints (SearchHome.tsx — contextual hints as user types)
// ---------------------------------------------------------------------------
export const SEARCH_HINTS = [
    "Type a company name to start your unfair advantage",
    "Now add the role — the more specific, the better",
    "Add the round type, or we'll prep for everything",
    "Ready to go",
];

// ---------------------------------------------------------------------------
// Prep preset descriptions (PrepSettings.tsx)
// ---------------------------------------------------------------------------
export const PREP_PRESET_DESCRIPTIONS: Record<string, string> = {
    light: "Quick coffee-break refresher",
    standard: "The Goldilocks prep — just right",
    deep: "For the overachievers (we respect it)",
    panic: "Interview is tomorrow? Say no more.",
};

// ---------------------------------------------------------------------------
// Setup wizard nudge messages (WelcomeStep.tsx — moved from inline)
// ---------------------------------------------------------------------------
export const SETUP_NUDGES = [
    "Back so soon? Grabbing a free API key takes under 60 seconds. We timed it.",
    "We admire your commitment to avoidance, but the key is non-negotiable.",
    "Plot twist: you still need an API key. The good news? It's free.",
    "At this point you've spent more time closing this than it takes to get a key.",
    "Roses are red, violets are blue, you need an API key — we're not kidding, it's true.",
    "This wizard has more patience than your interviewer will. Add the key.",
    "We're running out of funny things to say. Please just add a key.",
    "OK you win the persistence award. But the key? Still required. Still free.",
    "Legend says there's a user who added their key on the first try. Be that user.",
    "We could do this all day. But wouldn't you rather prep for interviews?",
];

// ---------------------------------------------------------------------------
// Completion / success messages
// ---------------------------------------------------------------------------
export const COMPLETION = {
    setupTitle: "You're locked and loaded",
    setupMessage:
        "Your AI provider is connected and ready. Time to crush some interviews.",
    storySaved: "Banked! That story's going to land perfectly in an interview.",
    storySavedSub: "You can add more stories later from the dashboard.",
};

// ---------------------------------------------------------------------------
// Confirm-close dialog (RecipeWizardShell.tsx)
// ---------------------------------------------------------------------------
export const CONFIRM_CLOSE = {
    title: "Leave setup?",
    description:
        "Your progress will vanish into the void. But hey, you can always come back.",
};

// ---------------------------------------------------------------------------
// Login Required screens (library, applications)
// ---------------------------------------------------------------------------
export const LOGIN_REQUIRED = {
    library: {
        headings: [
            "Your stories need a home",
            "STAR stories without a login? That's just talking to yourself",
            "Your greatest hits album needs a record label (us)",
            "These stories are too good to live in your browser's memory",
            "Your interview stories called — they want cloud storage",
        ],
        subtexts: [
            "Log in to save your STAR stories, manage questions, and sync across devices. Your future self will thank you.",
            "One browser clear and poof — your best 'tell me about a time' answers vanish. Log in to keep them forever.",
            "We promise we won't judge your stories. We'll just make sure they're backed up.",
            "Your stories deserve better than localStorage. Give them the cloud treatment.",
        ],
    },
    applications: {
        headings: [
            "Your job hunt deserves a command center",
            "Tracking jobs in your head? Bold strategy. Risky, but bold.",
            "Your spreadsheet called. It wants you to upgrade.",
            "Job applications without a tracker is just organized chaos",
            "Remember that job you forgot to follow up on? Exactly.",
        ],
        subtexts: [
            "Log in to track applications, manage stages, and link tailored resumes. Spreadsheets are so 2019.",
            "One login and you'll never send the wrong resume to the wrong company again. Probably.",
            "Track every application, every stage, every 'we'll be in touch' that actually means something.",
            "Your job search deserves better than sticky notes and good intentions. Log in.",
        ],
    },
};

// ---------------------------------------------------------------------------
// Settings messages (SettingsContainer.tsx)
// ---------------------------------------------------------------------------
export const SETTINGS_MESSAGES = {
    resetLinkSent:
        "Reset link sent! Check your inbox (and spam, because email is fun like that).",
    resetLinkFailed: "Couldn't send the reset link. Try again in a sec.",
    dataExported: "Data exported! Your interview prep, portable and free.",
    dataExportFailed: "Export hit a snag. Give it another shot.",
    keyRemoved: (provider: string) =>
        `${provider} key removed. Gone, but not forgotten.`,
    keySaved: "Key saved! You're connected and ready to roll.",
    accountDeleteFailed:
        "Couldn't delete your account. That's... actually a good thing?",
};

// ---------------------------------------------------------------------------
// Output Preferences descriptions (SettingsContainer.tsx)
// ---------------------------------------------------------------------------
export const OUTPUT_PREF_DESCRIPTIONS = {
    strategyBrief: "Quick elevator pitch version",
    strategyStandard: "The full 'tell me about yourself' script",
    strategyDetailed: "Deep dive with specific project examples",
    coverShort: "Tight and punchy — one strong paragraph",
    coverStandard: "The classic three-paragraph letter",
    coverLong: "Comprehensive with multiple stories woven in",
};

// ---------------------------------------------------------------------------
// Auth form messages (login-form.tsx)
// ---------------------------------------------------------------------------
export const AUTH_MESSAGES = {
    missingCredentials:
        "We're going to need a username and password. Just the basics.",
};

// ---------------------------------------------------------------------------
// Resume tailor messages (resume-tailor/page.tsx)
// ---------------------------------------------------------------------------
export const RESUME_MESSAGES = {
    noJobPosting:
        "Paste a job posting first — we need to know what we're tailoring to.",
    noResumeData:
        "No resume found. Head to the Resume Builder to create one first.",
    analyzeFirst:
        "Analyze the job posting first, then we can work our magic.",
};

// ---------------------------------------------------------------------------
// Loading step messages (DashboardContainer.tsx — specific step indicators)
// ---------------------------------------------------------------------------
export const LOADING_STEPS = {
    parsing: "Decoding your request...",
    generating: "Crafting your personalized battle plan...",
    refreshing: "Giving those questions a fresh coat of paint...",
};

// ---------------------------------------------------------------------------
// Motivational banner — fallback quotes
// ---------------------------------------------------------------------------
export const BANNER_QUOTES = [
    // --- Interviewer & recruiter truths ---
    "You're more prepared than you think. Probably.",
    "The interviewer is just a person who also Googles things.",
    "Plot twist: the interviewer is also nervous about making small talk.",
    "Pro tip: the company needs you too. That's why the role exists.",
    "Interviews are just conversations where one person pretends they don't need the job.",
    "Recruiters spend 6 seconds on a resume. You're already ahead by being here.",
    "The hiring manager also forgot their first day of work.",
    "Your interviewer practiced their questions too. You're even.",
    "Behind every 'we'll circle back' email is a human who's also overwhelmed.",
    "That interviewer asking tough questions? They had to Google the answers too.",
    "Interviewers forget 90% of what you say. Make the 10% count.",
    "The recruiter reading your resume is also wondering what to have for lunch.",
    "Your future manager is hoping you say yes just as much as you're hoping they do.",
    "Hiring managers don't bite. Usually.",
    "The panel interview is just a group of people who couldn't agree on a time to meet individually.",
    "Your interviewer is also winging the small talk. Everyone is.",
    "Recruiters send 'exciting opportunity' emails at 2am. They get it.",
    "That 'culture fit' question? They're just asking if you're pleasant to be around.",
    "The person interviewing you was once the person being interviewed.",
    "HR is also trying to figure out what 'competitive salary' means.",
    // --- Imposter syndrome & confidence ---
    "Fun fact: nervousness and excitement are the same chemical. You're excited.",
    "Your imposter syndrome called. It wants you to know it's wrong.",
    "Confidence is just preparation with a good night's sleep.",
    "You don't have to be perfect. You have to be better than the other candidates.",
    "You've survived 100% of your worst days. An interview is just a Tuesday.",
    "Your worst interview story is someone else's 'at least I'm not that bad.'",
    "Everyone in the waiting room is also pretending to be calm.",
    "The secret to confidence: nobody knows you're nervous if you smile.",
    "You belong in that room. The invite proves it.",
    "Your experience is valid even if your brain says otherwise at 3am.",
    "Imposter syndrome is just success with anxiety. You've got both.",
    "The only person who thinks you're underqualified is you. And you're biased.",
    "You've been hired before. Someone saw something. They were right.",
    "The confidence gap is real. The skill gap? Probably not.",
    "Faking confidence and having confidence look exactly the same from the outside.",
    "You've done harder things than answer questions about yourself.",
    "The butterflies in your stomach are just your potential doing warmups.",
    "You're not an imposter. Imposters don't prepare this hard.",
    "Every expert started as someone who had no idea what they were doing.",
    "Your brain is lying when it says you're not ready. Brains do that.",
    // --- Preparation & practice ---
    "Someone less qualified than you got the job because they applied. Just saying.",
    "Today's prep is tomorrow's 'I nailed it' text to your friends.",
    "The best interview answer starts with actually preparing. You're here. Gold star.",
    "Every 'tell me about yourself' answer gets better with practice. This is practice.",
    "The STAR method: because rambling isn't a strategy.",
    "Behind every great offer letter is someone who didn't wing it.",
    "Your next job is one good interview away. No pressure. OK, a little pressure.",
    "The 'any questions for us?' part is not optional. You have questions. We'll help.",
    "Somewhere, a hiring manager is hoping you're as good as your resume says.",
    "Practice doesn't make perfect. Practice makes employed.",
    "The best answer to 'why should we hire you?' starts with preparation.",
    "You're not overthinking it. You're strategizing. There's a difference.",
    "The person who gets the offer rehearsed their answers in the shower.",
    "STAR method: Situation, Task, Action, Result. Not Stammer, Trail off, Apologize, Ramble.",
    "Your elevator pitch should be shorter than an actual elevator ride.",
    "The best interviewees sound natural because they practiced until it felt natural.",
    "Winging it is a strategy. A bad one, but a strategy.",
    "Rehearsing your answers isn't cheating. It's called being an adult.",
    "The difference between a good answer and a great answer is three practice runs.",
    "You're not studying for a test. You're practicing being awesome on demand.",
    "Preparation is the closest thing to a cheat code in interviews.",
    // --- Job search reality ---
    "Somewhere out there, a company is writing a job description and hoping you apply.",
    "The job market is tough. You're tougher. Probably.",
    "Every rejection is just redirection to a company that actually deserves you.",
    "Ghosted after an interview? The trash took itself out.",
    "The right job won't require you to be someone else. Just a slightly more polished you.",
    "Job descriptions are wish lists, not requirements. Apply anyway.",
    "If they wanted a unicorn, they'd have specified 'horn required.'",
    "The company that rejected you also rejected someone who's now a CEO.",
    "Not every interview leads to a job. Some lead to better interview skills.",
    "'Years of experience required' was written by someone who doesn't do the job.",
    "The job market is a numbers game. You only need to win once.",
    "That rejection email was probably a template. Don't take it personally.",
    "The perfect job doesn't exist. But a pretty great one does.",
    "Applying to jobs is like dating: you only need one to work out.",
    "Behind every 'we went with another candidate' is a company that missed out.",
    "The job search is a marathon, not a sprint. Hydrate.",
    "Your LinkedIn profile doesn't define you. But update it anyway.",
    "The best time to job search was yesterday. The second best is now.",
    "Every 'no' gets you statistically closer to a 'yes.'",
    "'Entry level, 5 years experience' means they don't know what they want.",
    "If the job posting says 'fast-paced environment,' they mean 'we're understaffed.'",
    // --- Resume & application truths ---
    "Your resume is a highlight reel, not an autobiography.",
    "Nobody reads cover letters. Write one anyway. It's a power move.",
    "The gap in your resume is called 'life.' It happens.",
    "A typo on your resume is not the end of the world. Usually.",
    "Your skills section shouldn't include 'Microsoft Word.' It's 2025.",
    "The perfect resume doesn't exi— actually, we can help with that.",
    "Tailoring your resume isn't lying. It's strategic truth-telling.",
    "One-page resume? Two-page resume? The real answer: whatever gets you hired.",
    "Your resume bullet points should start with verbs. 'Vibed' is not a verb. Well, it is, but don't.",
    "PDF, always. Nobody wants to see your resume reformat itself.",
    "Hobbies on a resume: fine. 'Netflix' as a hobby: bold.",
    "'References available upon request' is the resume equivalent of 'I'll tell you later.'",
    "Your resume doesn't need a photo. Your work speaks louder than your selfie.",
    "Action verbs: led, built, designed, shipped. Not: helped, assisted, tried.",
    "A resume with no numbers is just a list of job duties. Add metrics.",
    "If your resume is 4 pages, you've written a memoir. Edit.",
    "A cover letter that starts with 'To Whom It May Concern' concerns no one.",
    "Your resume is not your life story. Save the drama for the interview.",
    "Objective statements are dead. Summary statements are alive and thriving.",
    "Comic Sans on a resume is a choice. A wrong choice, but a choice.",
    // --- Interview tips disguised as humor ---
    "Arriving 15 minutes early is polite. Arriving 45 minutes early is unsettling.",
    "The answer to 'Tell me about yourself' is not your entire life story.",
    "'What's your greatest weakness?' 'This question.' Don't say that.",
    "Dress one level above the role. Unless it's a costume party.",
    "Eye contact: important. Unblinking stare: terrifying. Find the middle.",
    "When they say 'Do you have questions?' they mean 'Please have questions.'",
    "Google the company before the interview. Revolutionary, we know.",
    "Turn your phone off before the interview. Not on vibrate. Off.",
    "A firm handshake, not a bone crusher. Read the room.",
    "Always send a thank-you email. Always. Yes, even for that one.",
    "The best answer to 'Where do you see yourself in 5 years?' isn't 'Your job.'",
    "When in doubt, use the STAR method. When really in doubt, use it twice.",
    "Don't badmouth your old boss. Even if they deserve it. Especially if they deserve it.",
    "Virtual interview tip: pants are technically optional, but strongly recommended.",
    "'I'm a perfectionist' is not a weakness. Try again.",
    "Saying 'I don't know' is better than making something up. Interviewers can tell.",
    "Bring a copy of your resume. Yes, even though they have it. It's a flex.",
    "Your body language says more than your words. Uncross those arms.",
    "If you don't understand the question, ask them to repeat it. It's not a quiz show.",
    "The best interviewees ask great questions. The worst say 'Nah, I'm good.'",
    // --- Tech industry specific ---
    "'We're like a family here' means the boundaries are blurry.",
    "LeetCode is not personality. But it might get you hired.",
    "'Agile' means different things to different people. None of them agree.",
    "The whiteboard interview: where developers pretend markers aren't awful.",
    "System design interviews: where everyone pretends they've built Twitter.",
    "If the job says 'rockstar developer,' they want one person doing three jobs.",
    "'Unlimited PTO' often means 'guilt-limited PTO.'",
    "A take-home assignment should not take your entire home's weekend.",
    "Coding interviews test how you think, not whether you memorized algorithms.",
    "The best developers Google things. The best interviewees don't mention it.",
    "'Full-stack' means you'll be doing everything. Embrace it.",
    "Your GitHub profile is your portfolio. Commit accordingly.",
    "Side projects on your resume? Great. 'It's on my to-do list'? Less great.",
    "The technical interview isn't about the right answer. It's about the right thinking.",
    "'We use cutting-edge technology' means they rewrote everything last quarter.",
    "Pair programming interviews: where you debug someone else's code judgment-free.",
    "The behavioral round is not a break. It's where offers are won or lost.",
    "Culture fit interviews are just vibes with a rubric.",
    "If they ask for your salary expectations, they already have a number. Find it.",
    "'Competitive benefits' means they Googled what other companies offer.",
    // --- Motivation & mindset ---
    "The only interview you fail is the one you don't prepare for.",
    "Every expert was once a candidate who didn't know what STAR stood for.",
    "Your career is a marathon. This interview is just one water station.",
    "The best version of you shows up when you're prepared. We're making that version.",
    "Today's discomfort is tomorrow's comfort zone.",
    "You're not just looking for a job. You're looking for the next chapter.",
    "The fact that you're here means you take this seriously. That's half the battle.",
    "Overnight success takes about 10 years and 100 interviews.",
    "The interview is not a test. It's a conversation. A very stressful conversation.",
    "Your dream job is on the other side of preparation.",
    "Champions don't wing it. They prep. Like you're doing right now.",
    "Nerves mean you care. Apathy means you're at the wrong interview.",
    "Progress, not perfection. Unless the job is 'perfectionist.' Then, perfection.",
    "The person who said 'fake it till you make it' probably made it.",
    "You miss 100% of the jobs you don't apply to. Wayne Gretzky, probably.",
    "Think of the interview as a first date. One where you both have to prove yourselves.",
    "Interviews are temporary. Job offers are... well, also temporary. But the good kind.",
    "Your potential is someone's budget line item. Make it worth it.",
    "The hardest part is showing up. You did that. Everything else is momentum.",
    "A bad interview is a learning experience. A good one is a paycheck.",
    // --- Random observations ---
    "The office water cooler still exists. It's called Slack now.",
    "LinkedIn endorsements are the participation trophies of the professional world.",
    "'Casual Fridays' are the gateway to full-time athleisure.",
    "Your email signature says more about you than your cover letter.",
    "Business casual is the most confusing dress code ever invented.",
    "The real interview starts when they say 'So, any questions?'",
    "Corporate jargon is just improv for people in suits.",
    "The ping pong table in the office means the budget went somewhere interesting.",
    "'Work-life balance' is easier to type than to achieve.",
    "'Moving forward' in meetings means 'we're done talking about that problem.'",
    "Team-building exercises: where strangers become friends become LinkedIn connections.",
    "The best networking happens when you're not trying to network.",
    "Monday motivation is a myth. Monday coffee is reality.",
    "Open floor plans: because privacy is overrated, apparently.",
    "The meeting that could've been an email is the real company culture.",
    "'Let's take this offline' means 'I have no idea and neither do you.'",
    "'Synergy' was a perfectly good word until corporate got hold of it.",
    "'Circle back' means someone forgot and hopes you did too.",
    "Casual Fridays were invented by someone who was already wearing jeans.",
    "The free snacks in the break room are a trap. A delicious trap.",
    // --- Self-awareness & humor ---
    "You're reading motivational quotes on a job prep app. Peak main character energy.",
    "This quote rotates every few minutes. We have 300 of them. Yes, really.",
    "You've been staring at this screen for a while. Blink.",
    "If this quote made you smile, you're emotionally ready for the interview.",
    "We wrote 300 of these. Some are better than others. This might be one of the others.",
    "This banner is the emotional support animal of interview prep.",
    "We considered adding ads here. Instead, you get wisdom. You're welcome.",
    "This is the part of the app that believes in you unconditionally.",
    "If you're reading this, you're procrastinating. But in a productive way.",
    "Every time you refresh, you get a new quote. It's like a fortune cookie.",
    "We spent more time writing these quotes than some people spend on resumes.",
    "This quote is brought to you by caffeine and optimism.",
    "The developer who built this feature was also procrastinating. Solidarity.",
    "If you've read more than 5 of these, you're either very thorough or very nervous.",
    "This is the only part of interview prep that doesn't require a STAR answer.",
    "Fun fact: you've scrolled past this banner before. It had a different quote.",
    "We thought about putting a joke here. Then we realized the job market is the joke.",
    "300 quotes and counting. We might need therapy. Or a raise.",
    "This banner is proof that someone cares about your interview prep. That someone is code.",
    "If you're wondering who writes these: we are also wondering.",
    // --- Quick wisdom ---
    "Always negotiate the offer. Always.",
    "The thank-you email is not optional.",
    "Research the company. Then research them more.",
    "Preparation beats talent when talent doesn't prepare.",
    "The best answers are specific. Vague answers are forgettable.",
    "Stories sell. Bullet points inform. Do both.",
    "Body language is 55% of communication. Words are only 7%. Dress is the rest. Or something.",
    "Follow up. Then follow up again. Persistence ≠ desperation.",
    "Ask about the team, not just the role. You're interviewing them too.",
    "The job you want and the job description may be two different things. Ask questions.",
    "Be memorable for the right reasons.",
    "Your weakness should be real but not alarming. 'Arson' is too real.",
    "Know your numbers: metrics, impact, growth. Interviewers love numbers.",
    "The best negotiators are the most prepared. See? Prep pays off everywhere.",
    "Don't oversell. Don't undersell. Sell accurately with enthusiasm.",
    "Silence after answering is fine. It means they're processing, not judging. Usually.",
    "The company's 'About Us' page is your cheat sheet. Read it.",
    "Energy is contagious. Bring the right kind.",
    "Listen more than you talk. Then talk with purpose.",
    "The interview isn't over until you send the follow-up.",
    // --- Career philosophy ---
    "Your career path doesn't have to be a straight line. Zigzags are valid.",
    "No job is forever. Make each one count.",
    "The best career moves often look like risks at the time.",
    "You're not just getting a job. You're investing in future you.",
    "Skills transfer. Industries change. You adapt. That's the whole game.",
    "The job you want might not exist yet. That's exciting, not scary.",
    "Lateral moves are still moves. Sometimes the best ones.",
    "Your network is your net worth. Unless you have actual net worth. Then it's both.",
    "The career ladder is more like a career climbing wall. Multiple paths up.",
    "Every job teaches you something. Even the bad ones. Especially the bad ones.",
    "The best managers were once the worst interviewees. Growth happens.",
    "Work-life balance isn't a destination. It's a daily negotiation.",
    "Your first job doesn't define you. Neither does your fifth. Keep going.",
    "Career pivots aren't failures. They're plot twists.",
    "The interview is the appetizer. The job is the entree. The retirement is dessert.",
    "You're building a career, not just getting a paycheck. Think long-term.",
    "The skills you learn today are the leverage you have tomorrow.",
    "Don't compare your chapter 1 to someone else's chapter 20.",
    "Professional growth is uncomfortable. That's how you know it's working.",
    "Your dream job might be three good jobs away. Start with this one.",
    // --- Bonus round ---
    "The interview starts the moment you walk in. Fix your posture.",
    "Nobody ever got hired for saying 'I'm a team player' without an example.",
    "Phone screens are just interviews in pajamas. Dress up anyway. It helps.",
    "Technical interviews are just open-book tests where the book is your brain.",
    "The most overused interview answer: 'I work too hard.' The most honest: 'I procrastinate.'",
    "If the job description mentions 'wearing many hats,' buy a hat rack.",
    "Salary negotiations are awkward. Do them anyway. Future you insists.",
    "The interviewer asking 'walk me through your resume' doesn't want a walking tour.",
    "Two truths and a lie: great party game, terrible interview strategy.",
    "The best time to prep was yesterday. The second best time is right now.",
    "Every interviewer has a favorite question. Your job is to have a favorite answer.",
    "Coffee before an interview: yes. Three espressos: risky.",
    "The interview is a two-way street. One where you're slightly more lost.",
    "Nobody remembers the candidate who gave safe, boring answers.",
    "Your career didn't start at your first job. It started the first time someone said 'tell me about yourself.'",
    "The best salary negotiation tactic: knowing your worth. The worst: saying 'whatever you think is fair.'",
    "Interview attire rule: when in doubt, overdress. You can always remove a jacket.",
    "The thank-you email sweet spot: within 24 hours. Not within 24 seconds.",
    "Spell-check your interviewer's name. Twice. Then once more.",
    "If you can explain it to a five-year-old, you can explain it in an interview.",
    "The most powerful word in interviews: 'because.' It turns statements into stories.",
    "Don't memorize answers. Memorize stories. Then fit them to questions.",
    "Video interview background check: remove anything you wouldn't show your grandmother.",
    "The loudest person in the group interview isn't always the one who gets hired.",
    "Asking about next steps isn't pushy. It's interested. There's a difference.",
    "'Tell me about a time you failed' is not an invitation to confess everything.",
    "The follow-up email is free marketing. Use it.",
    "Interviews are like first dates: show interest but don't propose on the first one.",
    "The company culture section on their website is aspirational. Ask real employees.",
    "Your LinkedIn headline is your professional pickup line. Make it good.",
    "Every question is secretly asking: 'Can we work with this person every day?'",
    "'Why do you want this job?' Because rent, obviously. But say something nicer.",
    "If the interviewer checks their phone, your answer is too long.",
    "Being overqualified is just being extra prepared. Frame it that way.",
    "The worst they can say is no. Actually, the worst is ghosting. But you'll survive both.",
    "Your interview voice and your real voice are different people. Let them meet.",
    "The gap between interviews gets shorter the more you do them.",
    "Always have a '90-day plan' answer ready. It shows you think ahead.",
    "The company isn't doing you a favor by interviewing you. It's mutual evaluation.",
    "Nervous laughter in interviews: relatable. Nervous silence: powerful. Choose wisely.",
    "Your career is longer than any one interview. Keep perspective.",
    "The second interview means they like you. The third means they can't decide. The fourth means run.",
    "A rejection today is a redirection to something better. We hope.",
    "Nobody got their dream job by staying in their comfort zone.",
    "The best career advice: be so good they can't ignore you. Or just prepare really well.",
    "Today is one day closer to your next offer letter.",
    "You're not just job hunting. You're opportunity collecting.",
    "The interview is temporary. The career growth is permanent.",
    "Keep going. The right company is looking for exactly your kind of weird.",
    "Your next employer just posted your dream job. Time to be ready.",
    "You've already done the hard part — you showed up. The rest is just talking.",
    "Think of every interview as a free masterclass in selling yourself.",
    "The best careers are built on preparation and a little bit of audacity.",
    "A good interview is just a great conversation with stakes. You've got this.",
    "One more prep session. One more practice answer. One step closer.",
    "Every interview you do makes the next one easier. This is your training montage.",
    "Your skills got you this interview. Your preparation will get you the offer.",
    "Plot twist: you're going to be great at this. The data supports it.",
    "Right now, somewhere, a company is about to get very lucky hiring you.",
];
