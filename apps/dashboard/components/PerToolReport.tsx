import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';

interface PerToolReportProps {
  readonly markdown: string;
}

export function PerToolReport({ markdown }: PerToolReportProps) {
  return (
    <div className="prose prose-invert prose-sm max-w-none text-[var(--color-fg)]">
      <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{markdown}</ReactMarkdown>
    </div>
  );
}
