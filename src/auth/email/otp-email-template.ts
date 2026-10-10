import { OTP_LIFETIME_MINUTES } from '../otp-lifetime';
import {
  brandHeader,
  cardRow,
  DARK,
  type EmailContent,
  emailDocument,
  heading,
  inkLink,
  LAYOUT_TABLE,
  LIGHT,
  MONO_FONTS,
  paragraph,
  SITE_HOST,
  SITE_URL,
  type TextBlock,
  wrapped,
} from './email-layout';
import { escapeHtml } from './escape-html';
import {
  OTP_EMAIL_MESSAGES,
  type OtpEmailLocale,
  type OtpEmailMessages,
} from './otp-email-messages';

export type { OtpEmailLocale } from './otp-email-messages';

const TEXT_CODE_INDENT = '    ';

const CODE_DARK_RULES = [
  `.ss-code{background-color:${DARK.code}!important;color:${DARK.accent}!important;}`,
];

function codeBlock(code: string): readonly string[] {
  const style =
    `background-color:${LIGHT.code};border-radius:8px;padding:20px 12px 20px 18px;` +
    `font-family:${MONO_FONTS};font-size:36px;line-height:44px;font-weight:700;` +
    `letter-spacing:6px;color:${LIGHT.accent};`;
  return [
    `<table ${LAYOUT_TABLE} width="100%">`,
    '<tr>',
    `<td class="ss-code" align="center" style="${style}">${escapeHtml(code)}</td>`,
    '</tr>',
    '</table>',
  ];
}

function card(code: string, messages: OtpEmailMessages): readonly string[] {
  return cardRow([
    heading(messages.heading),
    paragraph(
      { tone: 'muted', size: 'body', margin: '0 0 24px 0' },
      escapeHtml(messages.instruction),
    ),
    ...codeBlock(code),
    paragraph(
      { tone: 'ink', size: 'body', margin: '24px 0 0 0' },
      escapeHtml(messages.expiry(OTP_LIFETIME_MINUTES)),
    ),
    paragraph(
      { tone: 'muted', size: 'body', margin: '16px 0 0 0' },
      escapeHtml(messages.neverShare),
    ),
    paragraph(
      { tone: 'muted', size: 'body', margin: '8px 0 0 0' },
      escapeHtml(messages.notRequested),
    ),
  ]);
}

function footer(messages: OtpEmailMessages): readonly string[] {
  const footnote: TextBlock = {
    tone: 'muted',
    size: 'small',
    margin: '0 0 8px 0',
  };
  return [
    '<tr>',
    '<td style="padding:24px 8px 0 8px;">',
    paragraph(footnote, escapeHtml(messages.about)),
    paragraph(footnote, escapeHtml(messages.reason)),
    paragraph(
      { ...footnote, margin: '0' },
      `${escapeHtml(messages.site)}: ${inkLink(SITE_URL, SITE_HOST)}`,
    ),
    '</td>',
    '</tr>',
  ];
}

function buildHtml(code: string, messages: OtpEmailMessages): string {
  return emailDocument({
    language: messages.language,
    title: messages.subject(code),
    preheader: messages.preheader(code, OTP_LIFETIME_MINUTES),
    rows: [
      ...brandHeader(messages.logoAlt),
      ...card(code, messages),
      ...footer(messages),
    ],
    darkRules: CODE_DARK_RULES,
  });
}

function buildText(code: string, messages: OtpEmailMessages): string {
  return [
    messages.heading,
    '',
    ...wrapped(messages.instruction),
    '',
    `${TEXT_CODE_INDENT}${code}`,
    '',
    ...wrapped(messages.expiry(OTP_LIFETIME_MINUTES)),
    '',
    ...wrapped(messages.neverShare),
    ...wrapped(messages.notRequested),
    '',
    ...wrapped(messages.about),
    ...wrapped(messages.reason),
    `${messages.site}: ${SITE_URL}`,
  ].join('\n');
}

export function renderOtpEmail(
  code: string,
  messages: OtpEmailMessages,
): EmailContent {
  return {
    subject: messages.subject(code),
    html: buildHtml(code, messages),
    text: buildText(code, messages),
  };
}

export function buildOtpEmail(
  code: string,
  locale: OtpEmailLocale,
): EmailContent {
  return renderOtpEmail(code, OTP_EMAIL_MESSAGES[locale]);
}
