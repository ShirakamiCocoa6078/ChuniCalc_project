"use client";

import { Loader2 } from 'lucide-react';

export default function ResultPageContentSuspense() {
    return (
        <div className="flex min-h-screen flex-col items-center justify-center text-xl">
            <Loader2 className="w-10 h-10 animate-spin mr-2" />
            <p>Loading Results...</p>
        </div>
    );
} 