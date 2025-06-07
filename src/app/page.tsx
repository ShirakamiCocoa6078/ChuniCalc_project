
import ChuniCalcForm from "@/components/ChuniCalcForm";
import AdvancedSettings from "@/components/AdvancedSettings";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-start p-6 bg-background pt-12 md:pt-24">
      <ChuniCalcForm />
      <AdvancedSettings />
    </main>
  );
}
