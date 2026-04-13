export function TermsPage() {
  return (
    <div className="min-h-screen bg-[#0B0F0F] text-[#F2F7F7] px-6 py-16">
      <div className="max-w-4xl mx-auto bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-8 md:p-12">
        <h1 className="text-4xl font-black text-[#F2F7F7] mb-2">Terms of Service</h1>
        <p className="text-sm text-[#A8B2B2] mb-10">Last updated: March 12, 2026</p>

        <div className="space-y-8">
          <section>
            <h2 className="text-xl font-semibold text-[#F2F7F7] mb-3">1. Acceptance of Terms</h2>
            <p className="text-[#A8B2B2] leading-relaxed">
              By accessing or using ZeroBoard ("the Service"), you agree to be bound by these Terms of
              Service. If you do not agree to these terms, please do not use the Service. ZeroBoard is
              operated by ZeroClickDev. These terms apply to all visitors, users, and others who access
              the Service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#F2F7F7] mb-3">2. Free &amp; Paid Services</h2>
            <p className="text-[#A8B2B2] leading-relaxed">
              All core features — including boards, columns, cards, drag-and-drop, timeline view, card
              templates, and real-time sync — are <strong className="text-[#78fcd6]">FREE</strong>. The AI
              Assistant is available as an optional subscription at{' '}
              <strong className="text-[#F2F7F7]">$3/month</strong>. Paid subscriptions are billed monthly
              and may be cancelled at any time. Refunds are handled on a case-by-case basis — contact us
              if you have concerns.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#F2F7F7] mb-3">3. AI Rate Limits</h2>
            <p className="text-[#A8B2B2] leading-relaxed">
              ZeroClickDev is in control of the AI API rate limits and does not publish those numbers. If
              you ever hit a rate limit and the AI Assistant feature stops working, contact us immediately
              at{' '}
              <a href="mailto:support@zeroclickdev.ai" className="text-[#78fcd6] hover:underline">
                support@zeroclickdev.ai
              </a>{' '}
              and we will get you going again as quickly as possible.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#F2F7F7] mb-3">4. Account Registration</h2>
            <p className="text-[#A8B2B2] leading-relaxed">
              To access certain features, you must register for an account using a valid email address or
              a supported OAuth provider (Google). You are responsible for maintaining the confidentiality
              of your account credentials and for all activity that occurs under your account. You agree
              to notify us immediately of any unauthorized use of your account.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#F2F7F7] mb-3">5. User Conduct</h2>
            <p className="text-[#A8B2B2] leading-relaxed">
              You agree not to use the Service to: violate any laws or regulations; upload or transmit
              any content that is harmful, offensive, or infringes on intellectual property rights;
              attempt to gain unauthorized access to any part of the Service; or use automated means to
              scrape or abuse the Service. We reserve the right to terminate accounts that violate these
              guidelines.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#F2F7F7] mb-3">6. Intellectual Property</h2>
            <p className="text-[#A8B2B2] leading-relaxed">
              You retain ownership of all content (boards, cards, data) you create within the Service.
              By using the Service, you grant ZeroClickDev a limited, non-exclusive license to store and
              process your content solely for the purpose of providing the Service. The ZeroBoard
              application code is open source and licensed under its project license.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#F2F7F7] mb-3">7. Open Source</h2>
            <p className="text-[#A8B2B2] leading-relaxed">
              ZeroBoard is open source. Contributions are welcome under the project license. The source
              code is available on GitHub. Contributing to the project constitutes agreement to the
              project's contribution guidelines and license terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#F2F7F7] mb-3">8. Termination</h2>
            <p className="text-[#A8B2B2] leading-relaxed">
              You may delete your account at any time. We reserve the right to suspend or terminate your
              access to the Service at our sole discretion, without notice, for conduct that we believe
              violates these Terms or is harmful to other users, us, or third parties. Upon termination,
              your right to use the Service ceases immediately.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#F2F7F7] mb-3">9. Limitation of Liability</h2>
            <p className="text-[#A8B2B2] leading-relaxed">
              The Service is provided "as is" without warranties of any kind, either express or implied.
              To the fullest extent permitted by law, ZeroClickDev shall not be liable for any indirect,
              incidental, special, consequential, or punitive damages, or any loss of data or profits,
              arising from your use of or inability to use the Service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#F2F7F7] mb-3">10. Changes to Terms</h2>
            <p className="text-[#A8B2B2] leading-relaxed">
              We reserve the right to modify these Terms at any time. We will provide notice of
              significant changes by updating the "Last updated" date at the top of this page. Your
              continued use of the Service after any changes constitutes your acceptance of the new
              Terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#F2F7F7] mb-3">11. Contact</h2>
            <p className="text-[#A8B2B2] leading-relaxed">
              If you have any questions about these Terms, please contact us at{' '}
              <a href="mailto:support@zeroclickdev.ai" className="text-[#78fcd6] hover:underline">
                support@zeroclickdev.ai
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
