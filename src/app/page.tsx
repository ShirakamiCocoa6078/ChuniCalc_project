
"use client"; // Required for useLanguage hook

import ChuniCalcForm from "@/components/ChuniCalcForm";
import AdvancedSettings from "@/components/AdvancedSettings";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageToggle } from "@/components/LanguageToggle"; // Added
import { useLanguage } from "@/contexts/LanguageContext"; // Added
import { getTranslation } from "@/lib/translations"; // Added
import { Analytics } from "@vercel/analytics/next"

export default function Home() {
  const { locale } = useLanguage(); // Added

  return (
    <main className="flex min-h-screen flex-col items-center justify-start p-6 bg-background pt-8 md:pt-16">
      <div className="w-full max-w-md flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold font-headline text-primary">
          {getTranslation(locale, 'homePageTitle')} {/* Changed */}
        </h1>
        <div className="flex items-center space-x-2"> {/* Added for spacing toggles */}
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </div>
      <ChuniCalcForm />
      <AdvancedSettings />
      <Analytics/>
    </main>
  );
}
