import { html, useState } from '../../assets/vendor/htm-preact.js';
import { sb } from '../api.js';
import { useStore } from '../store.js';
import { t, LANGS, setLang, friendlyError } from '../i18n.js';
import { Icon, Segmented, Field, PasswordInput } from '../ui.js';
import { LogoMark } from '../logo.js';

export function AuthScreen() {
  const s = useStore();
  const [mode, setMode] = useState('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const cleanEmail = email.trim().toLowerCase();
    try {
      if (mode === 'in') {
        const { error: err } = await sb.auth.signInWithPassword({ email: cleanEmail, password });
        if (err) throw err;
      } else {
        if (password.length < 8) throw { code: 'weak' };
        const { data, error: err } = await sb.auth.signUp({
          email: cleanEmail,
          password,
          options: { data: { invite_code: code.trim() } },
        });
        if (err) throw err;
        if (!data.session) {
          const r = await sb.auth.signInWithPassword({ email: cleanEmail, password });
          if (r.error) throw r.error;
        }
      }
    } catch (ex) {
      setError(friendlyError(ex));
    } finally {
      setBusy(false);
    }
  }

  return html`<div class="auth">
    <div class="auth-lang">
      <${Icon} name="world" size=${18} />
      <select aria-label="Language" value=${s.lang} onChange=${(e) => setLang(e.target.value)}>
        ${LANGS.map((l) => html`<option value=${l.code}>${l.name}</option>`)}
      </select>
    </div>

    <div class="auth-card">
      <div class="auth-brand">
        <${LogoMark} size=${72} />
        <h1>Bountiful</h1>
        <p>${t('app.tagline')}</p>
      </div>

      <${Segmented} value=${mode} onChange=${(m) => { setMode(m); setError(''); }}
        options=${[{ value: 'in', label: t('auth.signin') }, { value: 'up', label: t('auth.create') }]} />

      <form onSubmit=${submit} class="stack-form">
        <${Field} label=${t('auth.email')}>
          <input class="input" type="email" inputmode="email" autocomplete="username" required
            value=${email} onInput=${(e) => setEmail(e.target.value)} />
        <//>
        ${mode === 'up' && html`<${Field} label=${t('auth.code')} hint=${t('auth.codeHelp')}>
          <input class="input code" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" required
            value=${code} onInput=${(e) => setCode(e.target.value.toUpperCase())} />
        <//>`}
        <${Field} label=${t('auth.password')} hint=${mode === 'up' ? t('auth.passwordHelp') : ''}>
          <${PasswordInput} value=${password} onInput=${(e) => setPassword(e.target.value)}
            autocomplete=${mode === 'in' ? 'current-password' : 'new-password'} />
        <//>

        ${error && html`<p class="form-error" role="alert"><${Icon} name="alert-circle" size=${18} />${error}</p>`}

        <button class="btn" type="submit" disabled=${busy}>
          ${busy ? t('common.loading') : mode === 'in' ? t('auth.submitIn') : t('auth.submitUp')}
        </button>
      </form>

      ${mode === 'up' && html`<p class="auth-note">${t('auth.note')}</p>`}
    </div>
  </div>`;
}
