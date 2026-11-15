import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  confirmLabel = 'Ya, Hapus',
  busy = false,
  onCancel,
  onConfirm,
}) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white border border-slate-200/90 rounded-t-3xl sm:rounded-2xl max-w-md w-full p-5 sm:p-6 pb-safe space-y-5 shadow-xl">
        <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto sm:hidden" aria-hidden="true" />
        <div className="flex items-start gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-red-50 border border-red-200 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-red-700" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base sm:text-lg font-display font-bold text-slate-900">{title}</h3>
            <p className="text-sm text-slate-600 mt-1 leading-relaxed">{message}</p>
          </div>
        </div>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="w-full sm:w-auto min-h-[46px] px-4 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-sm font-semibold text-slate-700 disabled:opacity-50"
          >
            Batal
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="w-full sm:w-auto min-h-[46px] px-5 py-2.5 rounded-xl bg-red-700 hover:bg-red-800 text-white text-sm font-semibold disabled:opacity-50"
          >
            {busy ? 'Memproses...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
