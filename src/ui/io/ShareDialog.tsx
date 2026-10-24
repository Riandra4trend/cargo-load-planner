import { Check, Copy, ExternalLink, Link2, TriangleAlert } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { formatNumber } from '../../domain/units';
import { buildShareUrl, SHARE_URL_WARN_LENGTH } from '../../io/share';
import { useStore } from '../../state/store';
import { Button } from '../common/Button';
import { inputClass } from '../common/fields';
import { Modal } from '../common/Modal';

const kb = (chars: number) => `${formatNumber(chars / 1024, 1)} KB`;

/** Copies text; falls back to a selected input + execCommand where the async clipboard API is unavailable. */
async function copyText(text: string, input: HTMLInputElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (!input) return false;
    input.focus();
    input.select();
    return document.execCommand('copy');
  }
}

/** Share link with the whole plan compressed into the URL hash. */
export function ShareDialog() {
  const plan = useStore((s) => s.plan);
  const closeDialog = useStore((s) => s.closeDialog);
  const toast = useStore((s) => s.toast);
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const close = useCallback(() => closeDialog('share'), [closeDialog]);

  const url = useMemo(() => buildShareUrl(plan), [plan]);
  const jsonChars = useMemo(() => JSON.stringify(plan).length, [plan]);
  const long = url.length > SHARE_URL_WARN_LENGTH;

  const copy = async () => {
    const ok = await copyText(url, input.current);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } else toast('Could not copy automatically; select the link and copy it manually.', 'error');
  };

  return (
    <Modal
      open
      icon={<Link2 />}
      title="Share link"
      onClose={close}
      footer={
        <>
          <a href={url} target="_blank" rel="noreferrer" className="mr-auto inline-flex items-center gap-1.5 text-xs font-medium text-info hover:underline">
            <ExternalLink className="h-3.5 w-3.5" /> Open in a new tab
          </a>
          <Button onClick={close}>Done</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink-soft">
          Anyone with this link opens a copy of <span className="font-medium text-ink">{plan.name}</span> as it is now: vehicles, items, placements and settings. Later edits are not
          synced; share a new link after changing the plan.
        </p>
        <div className="flex gap-2">
          <input
            ref={input}
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Share link"
            className={`${inputClass} font-mono text-xs`}
          />
          <Button variant="primary" icon={copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} onClick={() => void copy()}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <p className="text-xs text-muted num">
          Link length {kb(url.length)} · plan data {kb(jsonChars)}, compressed by {formatNumber((1 - url.length / jsonChars) * 100, 0)} %
        </p>
        {long && (
          <p className="flex items-start gap-2 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
            <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
            This link is longer than about {kb(SHARE_URL_WARN_LENGTH)}. Some chat apps, mail clients and browsers truncate long links; for large plans export the plan as JSON and send the
            file instead.
          </p>
        )}
      </div>
    </Modal>
  );
}
