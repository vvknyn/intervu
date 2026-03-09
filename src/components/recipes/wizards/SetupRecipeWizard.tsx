"use client";

import { useState, useCallback, useEffect } from "react";
import { RecipeWizardShell, type WizardStep } from "../RecipeWizardShell";
import { ConnectAIStep } from "../steps/ConnectAIStep";
import { ImportResumeStep } from "../steps/ImportResumeStep";
import { AddStoryStep } from "../steps/AddStoryStep";
import { RecipeCompleteStep } from "../steps/RecipeCompleteStep";
import { WelcomeStep } from "../steps/WelcomeStep";
import { StarStory } from "@/types";
import { saveStories } from "@/actions/save-story";
import { COMPLETION } from "@/lib/copy";

const STEPS: WizardStep[] = [
    { id: "welcome", label: "Welcome" },
    { id: "connect-ai", label: "Connect AI" },
    { id: "import-resume", label: "Import Resume", optional: true },
    { id: "add-story", label: "Add Story", optional: true },
];

interface SetupRecipeWizardProps {
    isOpen: boolean;
    onClose: () => void;
    onSaveApiKey: (provider: 'groq' | 'gemini' | 'openai', key: string) => Promise<void>;
    apiKeys: { groq?: string; gemini?: string; openai?: string };
    resume: string;
    onResumeChange: (text: string) => void;
    stories: StarStory[];
    onStoriesChange: (stories: StarStory[]) => void;
    dismissCount?: number;
}

export function SetupRecipeWizard({
    isOpen,
    onClose,
    onSaveApiKey,
    apiKeys,
    resume,
    onResumeChange,
    stories,
    onStoriesChange,
    dismissCount = 0,
}: SetupRecipeWizardProps) {
    const [currentStep, setCurrentStep] = useState(0);
    const [aiValid, setAiValid] = useState(!!(apiKeys.groq || apiKeys.gemini || apiKeys.openai));
    const [resumeValid, setResumeValid] = useState(!!resume);
    const [complete, setComplete] = useState(false);

    // Sync validity when props change (e.g., loaded asynchronously after mount)
    useEffect(() => {
        setAiValid(!!(apiKeys.groq || apiKeys.gemini || apiKeys.openai));
    }, [apiKeys.groq, apiKeys.gemini, apiKeys.openai]);

    useEffect(() => {
        setResumeValid(!!resume);
    }, [resume]);

    const handleStepChange = (step: number) => {
        setCurrentStep(step);
    };

    const handleStorySave = async (story: StarStory) => {
        const updated = [...stories, story];
        onStoriesChange(updated);
        try {
            await saveStories(updated);
        } catch (e) {
            console.error("Failed to save stories:", e);
        }
    };

    const handleComplete = () => {
        setComplete(true);
    };

    const handleDone = () => {
        setComplete(false);
        setCurrentStep(0);
        onClose();
    };

    const handleAiValidityChange = useCallback((valid: boolean) => {
        setAiValid(valid);
    }, []);

    const handleResumeValidityChange = useCallback((valid: boolean) => {
        setResumeValid(valid);
    }, []);

    const canAdvance = (() => {
        if (currentStep === 0) return true; // Welcome step always advanceable
        if (currentStep === 1) return aiValid; // API key is required
        return true; // Resume and story steps are optional
    })();

    if (complete) {
        return (
            <RecipeWizardShell
                isOpen={isOpen}
                onClose={handleDone}
                title="Set Up Intervu"
                description="Setup complete"
                steps={STEPS}
                currentStep={STEPS.length - 1}
                onStepChange={() => {}}
                showDefaultFooter={false}
            >
                <RecipeCompleteStep
                    title={COMPLETION.setupTitle}
                    message={COMPLETION.setupMessage}
                    ctaLabel="Start Preparing"
                    onCta={handleDone}
                />
            </RecipeWizardShell>
        );
    }

    return (
        <RecipeWizardShell
            isOpen={isOpen}
            onClose={onClose}
            title="Set Up Intervu"
            description="Let's get you set up in a few quick steps."
            steps={STEPS}
            currentStep={currentStep}
            onStepChange={handleStepChange}
            canAdvance={canAdvance}
            onComplete={handleComplete}
        >
            {currentStep === 0 && (
                <WelcomeStep dismissCount={dismissCount} />
            )}
            {currentStep === 1 && (
                <ConnectAIStep
                    apiKeys={apiKeys}
                    onSave={onSaveApiKey}
                    onValidityChange={handleAiValidityChange}
                />
            )}
            {currentStep === 2 && (
                <ImportResumeStep
                    resume={resume}
                    onResumeChange={onResumeChange}
                    onValidityChange={handleResumeValidityChange}
                />
            )}
            {currentStep === 3 && (
                <AddStoryStep
                    onSave={handleStorySave}
                />
            )}
        </RecipeWizardShell>
    );
}
