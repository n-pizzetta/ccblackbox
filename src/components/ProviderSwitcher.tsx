import type { Agent } from "../types";
import { PROVIDER_LABELS, type Provider } from "../utils/providers";

interface Props {
  providers: Agent[];
  value: Provider;
  onChange: (provider: Provider) => void;
}

export function ProviderSwitcher({ providers, value, onChange }: Props) {
  if (providers.length === 0) return null;
  if (providers.length === 1) {
    return <span className="provider-single">{PROVIDER_LABELS[providers[0]]}</span>;
  }
  return (
    <label className="scope-select provider-switcher">
      <span className={`provider-dot ${value}`} aria-hidden="true" />
      <select aria-label="Provider" value={value} onChange={(e) => onChange(e.target.value as Provider)}>
        <option value="all">All providers</option>
        {providers.map((provider) => (
          <option key={provider} value={provider}>{PROVIDER_LABELS[provider]}</option>
        ))}
      </select>
    </label>
  );
}
