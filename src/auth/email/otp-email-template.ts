export type OtpEmailLocale = 'pt' | 'en' | 'es';

interface OtpEmailStrings {
  subject: (code: string) => string;
  greeting: string;
  intro: string;
  expiry: string;
  ignore: string;
}

// Deliberately a plain string map rather than an i18n library: these three
// blocks are the only translated copy in this repo (all other user-facing
// translation lives in vertex-web's next-intl messages).
const STRINGS: Record<OtpEmailLocale, OtpEmailStrings> = {
  pt: {
    subject: (code) => `${code} é o seu código de acesso`,
    greeting: 'Olá!',
    intro: 'Use o código abaixo para entrar em samuelsantana.dev:',
    expiry: 'O código expira em 10 minutos.',
    ignore: 'Se você não solicitou este código, pode ignorar este e-mail.',
  },
  en: {
    subject: (code) => `${code} is your sign-in code`,
    greeting: 'Hello!',
    intro: 'Use the code below to sign in to samuelsantana.dev:',
    expiry: 'The code expires in 10 minutes.',
    ignore: "If you didn't request this code, you can ignore this email.",
  },
  es: {
    subject: (code) => `${code} es tu código de acceso`,
    greeting: '¡Hola!',
    intro: 'Usa el código de abajo para iniciar sesión en samuelsantana.dev:',
    expiry: 'El código expira en 10 minutos.',
    ignore: 'Si no solicitaste este código, puedes ignorar este correo.',
  },
};

export function buildOtpEmail(code: string, locale: OtpEmailLocale) {
  const s = STRINGS[locale];

  return {
    subject: s.subject(code),
    text: `${s.greeting}\n\n${s.intro}\n\n${code}\n\n${s.expiry}\n${s.ignore}\n`,
    html: `<!doctype html>
<html>
  <body style="margin:0;padding:32px 16px;background-color:#020617;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;">
    <div style="max-width:480px;margin:0 auto;background-color:#0f172a;border:1px solid #1e293b;border-radius:16px;padding:32px;">
      <p style="margin:0;color:#f1f5f9;font-size:16px;font-weight:600;">samuel<span style="color:#34d399;">santana</span>.dev</p>
      <p style="margin:24px 0 0;color:#cbd5e1;font-size:14px;">${s.greeting}</p>
      <p style="margin:8px 0 0;color:#cbd5e1;font-size:14px;">${s.intro}</p>
      <p style="margin:24px 0;text-align:center;">
        <span style="display:inline-block;background-color:#022c22;border:1px solid #065f46;border-radius:12px;padding:12px 24px;color:#34d399;font-size:28px;font-weight:700;letter-spacing:8px;">${code}</span>
      </p>
      <p style="margin:0;color:#94a3b8;font-size:12px;">${s.expiry}</p>
      <p style="margin:8px 0 0;color:#94a3b8;font-size:12px;">${s.ignore}</p>
    </div>
  </body>
</html>`,
  };
}
