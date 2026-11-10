import { html, useState } from '../../assets/vendor/htm-preact.js';
import { sb } from '../api.js';
import { useStore } from '../store.js';
import { t, friendlyError } from '../i18n.js';
import { Icon, Field, PasswordInput, LangMenu } from '../ui.js';
import { LogoMark } from '../logo.js';

export function AuthScreen() {
  const s = useStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const cleanEmail = email.trim().toLowerCase();
    try {
      const { error: err } = await sb.auth.signInWithPassword({ email: cleanEmail, password });
      if (err) throw err;
    } catch (ex) {
      setError(friendlyError(ex));
    } finally {
      setBusy(false);
    }
  }

  return html`<div class="auth">
    <div class="auth-lang"><${LangMenu} /></div>

    <div class="auth-card">
      <div class="auth-brand">
        <${LogoMark} size=${72} />
        <h1>Bountiful</h1>
        <p>${t('app.tagline')}</p>
      </div>

      <form onSubmit=${submit} class="stack-form">
        <${Field} label=${t('auth.email')}>
          <input class="input" type="email" inputmode="email" autocomplete="username" required
            value=${email} onInput=${(e) => setEmail(e.target.value)} />
        <//>
        <${Field} label=${t('auth.password')} hint="">
          <${PasswordInput} value=${password} onInput=${(e) => setPassword(e.target.value)}
            autocomplete="current-password" />
        <//>

        ${error && html`<p class="form-error" role="alert"><${Icon} name="alert-circle" size=${18} />${error}</p>`}

        <button class="btn" type="submit" disabled=${busy}>
          ${busy ? t('common.loading') : t('auth.submitIn')}
        </button>
      </form>

      <p class="auth-note">${t('auth.noAccount')}</p>
    </div>
  </div>`;
}
