import type { Metadata } from "next";
import { CONTACT_EMAIL, LAST_UPDATED, LEGAL_ENTITY, PRODUCT_NAME, SITE } from "../_meta";

export const metadata: Metadata = {
  title: "Terms of Service — ProjectSNS",
  description: "The terms governing your use of ProjectSNS.",
};

export default function TermsPage() {
  return (
    <>
      <h1>Terms of Service</h1>
      <p className="!text-zinc-500">Last updated: {LAST_UPDATED}</p>

      <p>
        These Terms of Service (“Terms”) govern your access to and use of{" "}
        {PRODUCT_NAME} at {SITE} (the “Service”), operated by{" "}
        <strong>{LEGAL_ENTITY}</strong> (“we”, “us”, “our”). By creating an
        account or using the Service, you agree to these Terms. If you do not
        agree, do not use the Service.
      </p>

      <h2>1. The Service</h2>
      <p>
        {PRODUCT_NAME} is a social-media management tool that lets you connect
        your own social media accounts (LinkedIn, Instagram, and TikTok), plan
        and schedule content, publish it through the platforms’ official APIs,
        view analytics, and optionally generate content suggestions using an AI
        model with an API key you provide.
      </p>

      <h2>2. Eligibility and accounts</h2>
      <ul>
        <li>You must be at least 18 years old and able to form a binding contract.</li>
        <li>
          If you use the Service on behalf of an organization, you represent that
          you are authorized to bind that organization to these Terms.
        </li>
        <li>
          You are responsible for keeping your account credentials secure and for
          all activity under your account.
        </li>
      </ul>

      <h2>3. Your content and connected accounts</h2>
      <ul>
        <li>
          You retain all rights to the content you create and publish through the
          Service. You grant us the limited rights necessary to store, process,
          and transmit it to the platforms you direct.
        </li>
        <li>
          You represent that you own or have the necessary rights to the content
          you publish and that it does not infringe any third party’s rights.
        </li>
        <li>
          You are solely responsible for the content you publish and for
          complying with the terms, policies, and community guidelines of each
          platform you connect (LinkedIn, Meta/Instagram, TikTok).
        </li>
        <li>
          You are responsible for any third-party API keys (such as an AI provider
          key) you supply and for any usage or costs incurred under them.
        </li>
      </ul>

      <h2>4. Acceptable use</h2>
      <p>You agree not to use the Service to:</p>
      <ul>
        <li>Publish unlawful, infringing, deceptive, harassing, or harmful content;</li>
        <li>Send spam or engage in inauthentic, automated, or manipulative behavior that violates a platform’s rules;</li>
        <li>Violate the terms or policies of any connected platform;</li>
        <li>Attempt to gain unauthorized access to, disrupt, reverse engineer, or misuse the Service or its infrastructure;</li>
        <li>Infringe the intellectual property or privacy rights of others.</li>
      </ul>

      <h2>5. Third-party platforms</h2>
      <p>
        {PRODUCT_NAME} is <strong>not affiliated with, endorsed by, or sponsored
        by</strong> LinkedIn, Meta, Instagram, or TikTok. Your use of those
        platforms through the Service is also subject to their own terms. The
        platforms control their APIs and may change, limit, suspend, or revoke
        access at any time, which may affect the Service. We are{" "}
        <strong>not responsible</strong> for the platforms’ actions, including any
        suspension, restriction, or removal of your accounts or content by a
        platform.
      </p>

      <h2>6. AI-generated suggestions</h2>
      <p>
        AI content suggestions are generated automatically and provided for your
        convenience. They may be inaccurate or unsuitable. You are responsible for
        reviewing, editing, and approving any content before it is published, and
        we make no guarantee as to the accuracy, quality, or results of AI
        suggestions.
      </p>

      <h2>7. Fees</h2>
      <p>
        The Service may be offered free of charge or on a paid basis. Where paid
        plans apply, the applicable fees and terms will be presented to you before
        you subscribe. We may introduce, change, or discontinue plans and pricing
        with reasonable notice.
      </p>

      <h2>8. Intellectual property</h2>
      <p>
        The Service, including its software, design, and trademarks, is owned by{" "}
        {LEGAL_ENTITY} and protected by law. These Terms do not grant you any
        rights in the Service other than the limited right to use it in accordance
        with these Terms.
      </p>

      <h2>9. Disclaimers</h2>
      <p>
        The Service is provided “as is” and “as available”, without warranties of
        any kind, whether express or implied, including fitness for a particular
        purpose and non-infringement. We do not warrant that the Service will be
        uninterrupted, error-free, or that content will always publish
        successfully, as this depends on third-party platforms.
      </p>

      <h2>10. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, {LEGAL_ENTITY} will not be liable
        for any indirect, incidental, special, consequential, or punitive damages,
        or for any loss of profits, data, goodwill, or business, arising out of or
        related to your use of the Service. Our total liability for any claim
        relating to the Service will not exceed the amount you paid us for the
        Service in the twelve months before the claim.
      </p>

      <h2>11. Indemnification</h2>
      <p>
        You agree to indemnify and hold harmless {LEGAL_ENTITY} from any claims,
        damages, or expenses arising from your content, your use of the Service,
        or your violation of these Terms or of any platform’s terms.
      </p>

      <h2>12. Termination</h2>
      <p>
        You may stop using the Service and delete your account at any time. We may
        suspend or terminate your access if you violate these Terms or if required
        to protect the Service or comply with law. Upon termination, your right to
        use the Service ends.
      </p>

      <h2>13. Governing law</h2>
      <p>
        These Terms are governed by the laws of the Republic of Indonesia. Any
        dispute arising from these Terms or the Service will be subject to the
        jurisdiction of the competent courts of Indonesia, without prejudice to
        any mandatory consumer protections available to you.
      </p>

      <h2>14. Changes to these Terms</h2>
      <p>
        We may update these Terms from time to time. We will revise the “Last
        updated” date above and, where appropriate, notify you. Continued use of
        the Service after changes take effect constitutes acceptance.
      </p>

      <h2>15. Contact us</h2>
      <p>
        Questions about these Terms:{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </>
  );
}
