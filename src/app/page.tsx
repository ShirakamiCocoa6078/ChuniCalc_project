
import ChuniCalcForm from "@/components/ChuniCalcForm";
import AdvancedSettings from "@/components/AdvancedSettings";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-start p-6 bg-background pt-8 md:pt-16">
      <div className="w-full max-w-md flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold font-headline text-primary">ChuniCalc</h1>
        <ThemeToggle />
      </div>
      <ChuniCalcForm />
      <AdvancedSettings />
    </main>
  );
}
