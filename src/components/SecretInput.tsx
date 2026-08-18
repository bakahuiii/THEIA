import { Eye, EyeOff } from "lucide-react";
import {
  useEffect,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";

type SecretInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: ReactNode;
  visibilityLabel: string;
  fieldClassName?: string;
  saved?: boolean;
  onRevealSaved?: () => Promise<string | null>;
  onRevealError?: (message: string) => void;
};

export function SecretInput({
  label,
  visibilityLabel,
  fieldClassName,
  saved = false,
  onRevealSaved,
  onRevealError,
  id,
  value,
  disabled,
  ...inputProps
}: SecretInputProps) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [revealedSavedValue, setRevealedSavedValue] = useState<string | null>(null);
  const hasValue = typeof value === "string" && value.length > 0;
  const hasSecret = hasValue || saved;
  const displayedValue = hasValue ? value : revealedSavedValue ?? value;

  useEffect(() => {
    if (hasValue || saved) return;
    setRevealed(false);
    setRevealedSavedValue(null);
  }, [hasValue, saved]);

  useEffect(() => {
    if (hasValue) setRevealedSavedValue(null);
  }, [hasValue]);

  const toggleVisibility = async () => {
    if (revealed) {
      setRevealed(false);
      setRevealedSavedValue(null);
      return;
    }
    if (hasValue) {
      setRevealed(true);
      return;
    }
    if (!saved || !onRevealSaved) return;
    setLoading(true);
    try {
      const secret = await onRevealSaved();
      if (!secret) throw new Error(`没有可显示的${visibilityLabel}`);
      setRevealedSavedValue(secret);
      setRevealed(true);
    } catch (error) {
      setRevealedSavedValue(null);
      setRevealed(false);
      onRevealError?.(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const actionLabel = `${revealed ? "隐藏" : "显示"}${visibilityLabel}`;

  return (
    <div
      className={["secret-input-field", fieldClassName]
        .filter(Boolean)
        .join(" ")}
    >
      <label className="secret-input-label" htmlFor={inputId}>{label}</label>
      <div className="secret-input-control">
        <input
          {...inputProps}
          id={inputId}
          className="secret-input"
          type={revealed ? "text" : "password"}
          value={displayedValue}
          readOnly={revealedSavedValue !== null || inputProps.readOnly}
          disabled={disabled}
        />
        <button
          className="secret-input-toggle"
          type="button"
          aria-label={actionLabel}
          aria-controls={inputId}
          aria-pressed={revealed}
          title={actionLabel}
          disabled={disabled || loading || !hasSecret}
          onClick={() => void toggleVisibility()}
        >
          {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );
}
