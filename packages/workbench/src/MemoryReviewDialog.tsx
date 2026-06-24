import type { MemoryConflict } from '@agentdeck/shared';

interface MemoryReviewDialogProps {
  conflict: MemoryConflict;
  onResolve: (action: 'apply' | 'skip' | 'edit') => void;
}

function MemoryReviewDialog({ conflict, onResolve }: Readonly<MemoryReviewDialogProps>) {
  let riskColor: string;
  if (conflict.riskLevel === 'critical') {
    riskColor = 'var(--color-danger)';
  } else if (conflict.riskLevel === 'high') {
    riskColor = '#ff9f43';
  } else if (conflict.riskLevel === 'medium') {
    riskColor = 'var(--color-warning)';
  } else {
    riskColor = 'var(--color-accent)';
  }

  return (
    <div className="approval-overlay" role="alertdialog" aria-modal="true" aria-label="Memory conflict">
      <div className="approval-dialog patch-conflict-dialog">
        <div className="approval-header">
          <h3 className="approval-title">Konflikt zapisu pamięci</h3>
          <span className="approval-risk-badge" style={{ borderColor: riskColor, color: riskColor }}>
            {conflict.kind}
          </span>
        </div>
        <div className="approval-body">
          <p className="approval-tool-name">{conflict.filePath}</p>
          <p className="approval-description">{conflict.description}</p>
          <p className="approval-description">
            Plik pamięci został zmodyfikowany od momentu propozycji. Agent musi ponownie zaproponować zmianę.
          </p>
        </div>
        <div className="approval-actions">
          <button className="approval-btn approval-btn--deny" type="button" onClick={() => onResolve('skip')}>
            Pomiń
          </button>
          <button className="approval-btn" type="button" onClick={() => onResolve('edit')}>
            Edytuj
          </button>
        </div>
      </div>
    </div>
  );
}

export { MemoryReviewDialog };
export type { MemoryReviewDialogProps };
