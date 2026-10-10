import { EMAIL_MARK_URL, SITE_URL, TEXT_LINE_WIDTH } from './email-layout';
import { OTP_EMAIL_LOCALES, type OtpEmailMessages } from './otp-email-messages';
import { buildOtpEmail, renderOtpEmail } from './otp-email-template';

const CODE = '000123';
const HTML_LINE_LIMIT = 400;
const GMAIL_CLIPPING_BYTES = 102 * 1024;
const HOSTILE = `<i>&"'`;
const ESCAPED_HOSTILE = '&lt;i&gt;&amp;&quot;&#39;';

const HOSTILE_MESSAGES: OtpEmailMessages = {
  language: 'en',
  subject: () => HOSTILE,
  preheader: () => HOSTILE,
  heading: HOSTILE,
  instruction: HOSTILE,
  expiry: () => HOSTILE,
  neverShare: HOSTILE,
  notRequested: HOSTILE,
  about: HOSTILE,
  reason: HOSTILE,
  site: HOSTILE,
  logoAlt: HOSTILE,
};
const HTML_SLOTS_IN_HOSTILE_MESSAGES = 11;

function longestLine(content: string): number {
  return Math.max(...content.split('\n').map((line) => line.length));
}

function occurrences(content: string, fragment: string): number {
  return content.split(fragment).length - 1;
}

describe('buildOtpEmail in Portuguese', () => {
  const email = buildOtpEmail(CODE, 'pt');

  it('keeps the code first in the subject, leading zeros included', () => {
    expect(email.subject).toBe(
      '000123 é o seu código para entrar em samuelsantana.dev',
    );
  });

  it('shows the code in the inbox list through a hidden preheader', () => {
    expect(email.html).toMatch(
      /<div style="display:none;[^"]*">Seu código é 000123\. Ele expira em 10 minutos/,
    );
  });

  it('names the sign-in window the way the site titles it', () => {
    expect(email.html).toContain(
      'Digite este código na janela “Entrar” de samuelsantana.dev.',
    );
  });

  it('says how long the code lasts, that it works once, and how to treat it', () => {
    for (const part of [email.html, email.text]) {
      expect(part).toContain('Ele expira em 10 minutos e só vale uma vez.');
      expect(part).toContain('Nunca compartilhe este código.');
      expect(part).toContain(
        'Não pediu para entrar? Pode ignorar este e-mail:',
      );
    }
  });

  it('ends with what the site is, why the email came and the site address', () => {
    for (const part of [email.html, email.text]) {
      expect(part).toContain('samuelsantana.dev é o blog do Samuel Santana');
      expect(part).toContain(
        'Você recebeu este e-mail porque alguém pediu para entrar',
      );
    }
    expect(email.text).toContain(`Blog: ${SITE_URL}`);
  });

  it('declares Portuguese as its language', () => {
    expect(email.html).toContain('<html lang="pt" dir="ltr">');
  });
});

describe('buildOtpEmail in English and Spanish', () => {
  it('keeps the code first in the English subject and window title', () => {
    const email = buildOtpEmail(CODE, 'en');
    expect(email.subject).toBe(
      '000123 is your sign-in code for samuelsantana.dev',
    );
    expect(email.html).toContain(
      'Enter this code in the “Sign in” window on samuelsantana.dev.',
    );
    expect(email.html).toContain('<html lang="en" dir="ltr">');
  });

  it('keeps the code first in the Spanish subject and window title', () => {
    const email = buildOtpEmail(CODE, 'es');
    expect(email.subject).toBe(
      '000123 es tu código para entrar en samuelsantana.dev',
    );
    expect(email.html).toContain(
      'Escribe este código en la ventana “Iniciar sesión” de samuelsantana.dev.',
    );
    expect(email.html).toContain('<html lang="es" dir="ltr">');
  });
});

describe('buildOtpEmail in every language', () => {
  it.each(OTP_EMAIL_LOCALES)(
    '%s: shows the code once in a monospace block and once in the text',
    (locale) => {
      const email = buildOtpEmail(CODE, locale);
      expect(occurrences(email.html, `>${CODE}<`)).toBe(1);
      expect(email.html).toMatch(
        /class="ss-code"[^>]*font-family:ui-monospace/,
      );
      expect(email.text).toContain(`    ${CODE}`);
    },
  );

  it.each(OTP_EMAIL_LOCALES)(
    '%s: carries the brand mark, the wordmark and a light and dark scheme',
    (locale) => {
      const email = buildOtpEmail(CODE, locale);
      expect(email.html).toContain(`<img src="${EMAIL_MARK_URL}"`);
      expect(email.html).toContain('samuel<span class="ss-accent"');
      expect(email.html).toContain(
        '<meta name="color-scheme" content="light dark">',
      );
      expect(email.html).toContain('@media (prefers-color-scheme:dark){');
    },
  );

  it.each(OTP_EMAIL_LOCALES)(
    '%s: stays under the Gmail clipping size with short lines',
    (locale) => {
      const email = buildOtpEmail(CODE, locale);
      expect(Buffer.byteLength(email.html, 'utf8')).toBeLessThan(
        GMAIL_CLIPPING_BYTES,
      );
      expect(longestLine(email.html)).toBeLessThanOrEqual(HTML_LINE_LIMIT);
      expect(longestLine(email.text)).toBeLessThanOrEqual(TEXT_LINE_WIDTH);
    },
  );

  it.each(OTP_EMAIL_LOCALES)(
    '%s: has no tracking pixel and no link other than the site',
    (locale) => {
      const email = buildOtpEmail(CODE, locale);
      expect(occurrences(email.html, '<img')).toBe(1);
      expect(occurrences(email.html, '<a ')).toBe(1);
      expect(email.html).toContain(`href="${SITE_URL}"`);
    },
  );
});

describe('renderOtpEmail', () => {
  it('escapes every message slot that reaches the HTML', () => {
    const email = renderOtpEmail(CODE, HOSTILE_MESSAGES);
    expect(email.html).not.toContain(HOSTILE);
    expect(occurrences(email.html, ESCAPED_HOSTILE)).toBe(
      HTML_SLOTS_IN_HOSTILE_MESSAGES,
    );
    expect(email.text).toContain(HOSTILE);
  });

  it('escapes the code itself', () => {
    const email = renderOtpEmail('<1&2>', HOSTILE_MESSAGES);
    expect(email.html).toContain('&lt;1&amp;2&gt;');
    expect(email.html).not.toContain('<1&2>');
  });
});
