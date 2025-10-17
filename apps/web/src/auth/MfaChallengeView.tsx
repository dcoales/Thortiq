import { useEffect, useState } from "react";

import { AuthErrorNotice, useAuthActions, useAuthMfaChallenge } from "@thortiq/client-react";

export const MfaChallengeView = () => {
  const challenge = useAuthMfaChallenge();
  const { submitMfa, cancelMfa } = useAuthActions();
  const [methodId, setMethodId] = useState<string | undefined>(undefined);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (challenge?.methods?.length && !methodId) {
      setMethodId(challenge.methods[0]?.id);
    }
  }, [challenge, methodId]);

  if (!challenge) {
    return null;
  }

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    if (!code) {
      return;
    }
    setSubmitting(true);
    try {
      await submitMfa(code, methodId);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mfa-panel">
      <h1>Verify it’s you</h1>
      <p>Enter the verification code from your authenticator.</p>
      <form onSubmit={handleSubmit} noValidate>
        {challenge.methods.length > 1 ? (
          <label>
            Method
            <select value={methodId} onChange={(event) => setMethodId(event.target.value)} disabled={submitting}>
              {challenge.methods.map((method) => (
                <option key={method.id} value={method.id}>
                  {method.label ?? method.type}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label htmlFor="mfa-code">Verification code</label>
        <input
          id="mfa-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(event) => setCode(event.target.value.trim())}
          disabled={submitting}
          required
        />
        <div className="mfa-actions">
          <button type="submit" disabled={submitting}>
            {submitting ? "Verifying…" : "Verify"}
          </button>
          <button type="button" className="link-button" onClick={() => cancelMfa()} disabled={submitting}>
            Cancel
          </button>
        </div>
        <AuthErrorNotice />
      </form>
    </div>
  );
};
