import React, { useMemo } from 'react';
import katex from 'katex';

interface MathRendererProps {
  content: string;
  className?: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export const MathRenderer: React.FC<MathRendererProps> = ({ content, className = '' }) => {
  const renderedHtml = useMemo(() => {
    if (!content) return '';
    // Split on $$...$$ (block) and $...$ (inline), preserving safe inline HTML tags like <strong>, <em>, <br>
    const tokens = content.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g);
    return tokens
      .map((token) => {
        if (token.startsWith('$$') && token.endsWith('$$')) {
          const expr = token.slice(2, -2).trim();
          try {
            return katex.renderToString(expr, { displayMode: true, throwOnError: false });
          } catch {
            return escapeHtml(token);
          }
        }
        if (token.startsWith('$') && token.endsWith('$')) {
          const expr = token.slice(1, -1).trim();
          try {
            return katex.renderToString(expr, { displayMode: false, throwOnError: false });
          } catch {
            return escapeHtml(token);
          }
        }
        // Allow safe formatting tags while stripping scripts
        return token.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
      })
      .join('');
  }, [content]);

  return (
    <span
      className={`leading-relaxed break-words ${className}`}
      dangerouslySetInnerHTML={{ __html: renderedHtml }}
    />
  );
};
