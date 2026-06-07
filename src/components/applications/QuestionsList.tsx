"use client";

import { useEffect, useState } from "react";
import { InterviewQuestion, getInterviewQuestions, deleteInterviewQuestion } from "@/actions/interview-questions";
import { toast, confirmToast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Plus, Trash as Trash2, Robot as Bot } from "@phosphor-icons/react";
import { AddQuestionModal } from "./AddQuestionModal";
import { cn } from "@/lib/utils";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";

interface QuestionsListProps {
    applicationId?: string;
}

export function QuestionsList({ applicationId }: QuestionsListProps) {
    const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);

    const loadQuestions = async () => {
        setLoading(true);
        try {
            const result = await getInterviewQuestions(applicationId);
            if (result.data) {
                setQuestions(result.data);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadQuestions();
    }, [applicationId]);

    const handleDelete = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent accordion toggle
        const ok = await confirmToast({
            title: "Delete question?",
            description: "This interview question will be permanently removed.",
            confirmLabel: "Delete",
            destructive: true,
        });
        if (!ok) return;

        try {
            await deleteInterviewQuestion(id);
            setQuestions(prev => prev.filter(q => q.id !== id));
        } catch (e) {
            console.error("Failed to delete", e);
            toast.error("Failed to delete question. Please try again.");
        }
    };

    if (loading) {
        return (
            <div className="space-y-4">
                {[1, 2].map(i => (
                    <div key={i} className="h-24 bg-card rounded-xl animate-pulse" />
                ))}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                    Start Adding Questions
                    <span className="text-xs font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                        {questions.length}
                    </span>
                </h3>
                <Button size="sm" onClick={() => setModalOpen(true)} className="gap-2">
                    <Plus size={16} />
                    Add Question
                </Button>
            </div>

            {questions.length === 0 ? (
                <div className="text-center py-12 border-2 border-dashed border-muted rounded-xl bg-muted/20">
                    <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center mx-auto mb-4 text-muted-foreground">
                        <Bot size={24} />
                    </div>
                    <h4 className="font-medium mb-1">No questions recorded yet</h4>
                    <p className="text-sm text-muted-foreground mb-4 max-w-[300px] mx-auto">
                        Add questions used in your interviews to build your personal knowledge base.
                    </p>
                    <Button variant="outline" onClick={() => setModalOpen(true)}>
                        Record First Question
                    </Button>
                </div>
            ) : (
                <Accordion type="single" collapsible className="w-full space-y-2">
                    {questions.map((q) => (
                        <AccordionItem
                            key={q.id}
                            value={q.id}
                            className="bg-card border rounded-xl px-4 py-1"
                        >
                            <div className="flex items-start justify-between py-3">
                                <AccordionTrigger className="hover:no-underline py-0 flex-1 text-left">
                                    <div className="flex flex-col gap-2 text-left w-full pr-4">
                                        <span className="font-medium text-base leading-snug">{q.question}</span>
                                        <div className="flex flex-wrap gap-2">
                                            {q.tags && q.tags.map(tag => (
                                                <Badge key={tag} variant="secondary" className="text-[10px] h-5 px-1.5 font-normal">
                                                    {tag}
                                                </Badge>
                                            ))}
                                        </div>
                                    </div>
                                </AccordionTrigger>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="text-muted-foreground hover:text-destructive h-8 w-8 -mr-2"
                                    onClick={(e) => handleDelete(q.id, e)}
                                >
                                    <Trash2 size={14} />
                                </Button>
                            </div>
                            <AccordionContent className="pt-2 pb-4 text-muted-foreground border-t mt-2">
                                <div className="prose prose-sm dark:prose-invert max-w-none">
                                    <p className="whitespace-pre-wrap">{q.answer}</p>
                                </div>
                            </AccordionContent>
                        </AccordionItem>
                    ))}
                </Accordion>
            )}

            <AddQuestionModal
                open={modalOpen}
                onOpenChange={setModalOpen}
                applicationId={applicationId}
                onSuccess={loadQuestions}
            />
        </div>
    );
}
