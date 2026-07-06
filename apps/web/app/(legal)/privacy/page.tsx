import type { Metadata } from "next";
import {
  ADDRESS,
  CONTACT_EMAIL,
  CONTACT_PHONE,
  LAST_UPDATED,
  LEGAL_ENTITY,
  PRODUCT_NAME,
  SITE,
} from "../_meta";

export const metadata: Metadata = {
  title: "Privacy Policy — ProjectSNS",
  description: "How ProjectSNS collects, uses, and protects your data.",
};

export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p className="!text-zinc-500">Last updated: {LAST_UPDATED}</p>

      <p>
        This Privacy Policy explains how <strong>{LEGAL_ENTITY}</strong> (“we”,
        “us”, “our”), operator of {PRODUCT_NAME} at {SITE} (the “Service”),
        collects, uses, stores, and protects your personal data when you use the
        Service. We are committed to handling your data in accordance with the
        Republic of Indonesia’s Law No. 27 of 2022 on Personal Data Protection
        (UU PDP).
      </p>

      <h2>1. Who we are</h2>
      <p>
        {LEGAL_ENTITY}
        <br />
        {ADDRESS}
        <br />
        Email: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        <br />
        Phone: {CONTACT_PHONE}
      </p>

      <h2>2. What ProjectSNS does</h2>
      <p>
        {PRODUCT_NAME} is a social-media management tool. It lets you connect
        your own social media accounts (LinkedIn, Instagram, and TikTok), plan
        and schedule content, publish that content to those accounts through the
        platforms’ official APIs, view analytics about your posts, and optionally
        generate content suggestions using an AI model with an API key you
        provide.
      </p>

      <h2>3. Data we collect</h2>
      <ul>
        <li>
          <strong>Account data:</strong> the email address you sign in with,
          managed through our authentication provider.
        </li>
        <li>
          <strong>Workspace data:</strong> your workspace name, company profile,
          goals, brand information, and settings that you enter.
        </li>
        <li>
          <strong>Connected accounts:</strong> when you connect a social account,
          we receive and store the account identifier, display name, avatar, and
          the <strong>OAuth access and refresh tokens</strong> the platform
          issues. These tokens are <strong>encrypted at rest</strong> and are
          used only to act on your behalf as you direct.
        </li>
        <li>
          <strong>Content you create:</strong> post captions and any images or
          videos you upload to publish.
        </li>
        <li>
          <strong>Analytics:</strong> performance metrics (such as impressions,
          likes, comments, shares, and views) that we retrieve from the connected
          platforms for content associated with your account.
        </li>
        <li>
          <strong>AI provider key:</strong> if you enable AI suggestions, the
          third-party AI API key you supply, which is{" "}
          <strong>encrypted at rest</strong> and used only to make requests you
          initiate.
        </li>
        <li>
          <strong>Activity logs:</strong> records of key actions (connecting an
          account, approving, publishing, and settings changes) for security and
          troubleshooting.
        </li>
      </ul>

      <h2>4. How we use your data</h2>
      <ul>
        <li>To publish and schedule the content you create to your connected accounts.</li>
        <li>To retrieve and display analytics about your content.</li>
        <li>To generate AI content suggestions, only when you request them and using the key you provide.</li>
        <li>To operate, secure, maintain, and improve the Service.</li>
        <li>To communicate with you about your account and the Service.</li>
      </ul>
      <p>
        We do <strong>not</strong> sell your personal data or the data we access
        from connected platforms, and we do not use it for advertising.
      </p>

      <h2>5. Platform data (LinkedIn, Meta/Instagram, TikTok)</h2>
      <p>
        When you connect a social account, we access data from that platform{" "}
        <strong>only through its official API</strong> and{" "}
        <strong>only to provide the features you use</strong> (publishing,
        analytics, and account identity). Our use of information received from
        these platforms adheres to each platform’s developer terms and policies,
        including the LinkedIn API Terms, the Meta Platform Terms and Developer
        Policies, and the TikTok Developer Terms of Service. We retain platform
        data only as long as needed to provide the Service, and we delete it when
        you disconnect the account or on your request.
      </p>

      <h2>6. Service providers and subprocessors</h2>
      <p>We rely on the following providers to run the Service:</p>
      <ul>
        <li>
          <strong>Supabase</strong> — database, authentication, and file storage
          hosting (
          <a href="https://supabase.com/privacy" target="_blank" rel="noreferrer">
            privacy policy
          </a>
          ).
        </li>
        <li>
          <strong>The social platforms you connect</strong> — LinkedIn, Meta
          (Instagram), and TikTok, which receive the content and requests you
          direct to them.
        </li>
        <li>
          <strong>Anthropic</strong> — only if you enable AI suggestions, your
          prompts are sent to Anthropic’s API using your key (
          <a href="https://www.anthropic.com/legal/privacy" target="_blank" rel="noreferrer">
            privacy policy
          </a>
          ).
        </li>
      </ul>

      <h2>7. How we protect your data</h2>
      <ul>
        <li>OAuth tokens and AI API keys are encrypted at rest using AES-256-GCM.</li>
        <li>Each workspace’s data is isolated from others through row-level security.</li>
        <li>Secrets are accessible only to the Service’s backend, never exposed to other users.</li>
      </ul>
      <p>
        No method of transmission or storage is completely secure, but we take
        reasonable measures to protect your data.
      </p>

      <h2>8. Data retention and deletion</h2>
      <p>
        We keep your data for as long as your account is active or as needed to
        provide the Service. You can delete your data at any time by:
      </p>
      <ul>
        <li>Disconnecting a channel, which removes its stored tokens;</li>
        <li>Deleting your workspace, which removes its associated data; or</li>
        <li>
          Emailing us at{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> to request
          deletion of your account and personal data.
        </li>
      </ul>
      <p>We will action verified deletion requests within a reasonable period.</p>

      <h2>9. Your rights</h2>
      <p>
        Under UU PDP and applicable law, you have the right to access, correct,
        update, and delete your personal data, to withdraw consent, and to object
        to or restrict certain processing. To exercise these rights, contact us at{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <h2>10. Cookies</h2>
      <p>
        We use a strictly necessary cookie to keep you signed in. We do not use
        advertising or third-party tracking cookies.
      </p>

      <h2>11. International transfers</h2>
      <p>
        Your data may be processed on servers located outside Indonesia by our
        service providers. Where this occurs, we take steps to ensure your data
        remains protected consistent with this policy.
      </p>

      <h2>12. Children</h2>
      <p>
        The Service is not directed to individuals under 18, and we do not
        knowingly collect their data.
      </p>

      <h2>13. Changes to this policy</h2>
      <p>
        We may update this policy from time to time. We will revise the “Last
        updated” date above and, where appropriate, notify you.
      </p>

      <h2>14. Contact us</h2>
      <p>
        Questions or requests regarding this policy or your data:{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </>
  );
}
