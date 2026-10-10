export type OtpEmailLocale = 'pt' | 'en' | 'es';

export const OTP_EMAIL_LOCALES: readonly OtpEmailLocale[] = ['pt', 'en', 'es'];

export interface OtpEmailMessages {
  readonly language: OtpEmailLocale;
  readonly subject: (code: string) => string;
  readonly preheader: (code: string, minutes: number) => string;
  readonly heading: string;
  readonly instruction: string;
  readonly expiry: (minutes: number) => string;
  readonly neverShare: string;
  readonly notRequested: string;
  readonly about: string;
  readonly reason: string;
  readonly site: string;
  readonly logoAlt: string;
}

export const OTP_EMAIL_MESSAGES: Readonly<
  Record<OtpEmailLocale, OtpEmailMessages>
> = {
  pt: {
    language: 'pt',
    subject: (code) =>
      `${code} é o seu código para entrar em samuelsantana.dev`,
    preheader: (code, minutes) =>
      `Seu código é ${code}. Ele expira em ${String(minutes)} minutos e só vale uma vez.`,
    heading: 'Seu código para entrar',
    instruction: 'Digite este código na janela “Entrar” de samuelsantana.dev.',
    expiry: (minutes) =>
      `Ele expira em ${String(minutes)} minutos e só vale uma vez.`,
    neverShare:
      'Nunca compartilhe este código. Ninguém de samuelsantana.dev vai pedir esse código a você.',
    notRequested:
      'Não pediu para entrar? Pode ignorar este e-mail: ninguém entra sem este código.',
    about:
      'samuelsantana.dev é o blog do Samuel Santana sobre engenharia de software, arquitetura e código.',
    reason:
      'Você recebeu este e-mail porque alguém pediu para entrar em samuelsantana.dev com este endereço.',
    site: 'Blog',
    logoAlt: 'samuelsantana.dev',
  },
  en: {
    language: 'en',
    subject: (code) => `${code} is your sign-in code for samuelsantana.dev`,
    preheader: (code, minutes) =>
      `Your code is ${code}. It expires in ${String(minutes)} minutes and works once.`,
    heading: 'Your sign-in code',
    instruction:
      'Enter this code in the “Sign in” window on samuelsantana.dev.',
    expiry: (minutes) =>
      `It expires in ${String(minutes)} minutes and works once.`,
    neverShare:
      'Never share this code. No one from samuelsantana.dev will ever ask you for it.',
    notRequested:
      'Didn’t ask to sign in? You can ignore this email: no one can sign in without this code.',
    about:
      'samuelsantana.dev is Samuel Santana’s blog on software engineering, architecture and code.',
    reason:
      'You received this email because a sign-in to samuelsantana.dev was requested for this address.',
    site: 'Blog',
    logoAlt: 'samuelsantana.dev',
  },
  es: {
    language: 'es',
    subject: (code) => `${code} es tu código para entrar en samuelsantana.dev`,
    preheader: (code, minutes) =>
      `Tu código es ${code}. Caduca en ${String(minutes)} minutos y sirve una sola vez.`,
    heading: 'Tu código para entrar',
    instruction:
      'Escribe este código en la ventana “Iniciar sesión” de samuelsantana.dev.',
    expiry: (minutes) =>
      `Caduca en ${String(minutes)} minutos y sirve una sola vez.`,
    neverShare:
      'Nunca compartas este código. Nadie de samuelsantana.dev te lo va a pedir.',
    notRequested:
      '¿No pediste entrar? Puedes ignorar este correo: nadie entra sin este código.',
    about:
      'samuelsantana.dev es el blog de Samuel Santana sobre ingeniería de software, arquitectura y código.',
    reason:
      'Recibiste este correo porque alguien pidió entrar en samuelsantana.dev con esta dirección.',
    site: 'Blog',
    logoAlt: 'samuelsantana.dev',
  },
};
