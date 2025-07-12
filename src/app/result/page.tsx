
import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import ResultContent from './ResultContent';

export default function ResultPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen flex-col items-center justify-center text-xl">
        <Loader2 className="w-10 h-10 animate-spin mr-2" />
        <p>결과 페이지 로딩 중...</p>
      </div>
    }>
      <ResultContent />
    </Suspense>
  );
}

