export function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#0B0F0F] text-[#F2F7F7] px-6 py-16">
      <div className="max-w-4xl mx-auto bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-8 md:p-12">
        <h1 className="text-4xl font-black text-[#F2F7F7] mb-2">Privacy Policy</h1>
        <p className="text-sm text-[#A8B2B2] mb-10">Last updated: March 12, 2026</p>

        <div className="space-y-8">
          <section>
            <h2 className="text-xl font-semibold text-[#F2F7F7] mb-3">1. Information We Collect</h2>
            <p className="text-[#A8B2B2] leading-relaxed">
              When you create an account, we collect your email address and, if you sign in with Google
              OAuth, your name and profile picture as provided by Google. We also store the board, column,
              and card data you create while using ZeroBoard. We do not collect payment information
              directly — payments are processed by our third-party payment processor.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#F2F7F7] mb-3">2. How We Use Your Information</h2>
            <p className="text-[#A8B2B2] leading-relaxed">
              We use the information we collect to: provide and improve the Service; authenticate your
              identity and maintain your account; sync your boards and cards across devices; send
              transactional emails (e.g., email confirmation, password reset); respond to support
              requests; and operate the AI Assistant feature (for AI Pro subscribers). We do not use your
              data to serve advertisements.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#F2F7F7] mb-3">3. Data Sharing</h2>
            <p className="text-[#A8B2B2] leading-relaxed">
              <strong className="text-[#78fcd6]">We do NOT sell your data.</strong> We do not share your
              data with third-party marketers. We may share data with service providers who assist in
              operating the Service (such as Supabase for database hosting), but only to the extent
              necessary to provide those services. We may also disclose data if required by law or to
              protect the rights and safety of ZeroClickDev, our users, or the public.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#F2F7F7] mb-3">4. Data Storage &amp; Security</h2>
            <p className="text-[#A8B2B2] leading-relaxed">
              Data is stored with Supabase (PostgreSQL) with Row Level Security (RLS) enforced at the
              database level — your data is only accessible to your authenticated account. All data in
              transit is encrypted via HTTPS. We take reasonable technical and organizational measures to
              protect your data, but no system is 100% secure and we cannot guarantee absolute security.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#F2F7F7] mb-3">5. Cookies</h2>
            <p className="text-[#A8B2B2] leading-relaxed">
              We use cookies and similar storage mechanisms (such as localStorage) to maintain your
              authentication session. We do not use tracking cookies or third-party advertising cookies.
              You can configure your browser to refuse cookies, but this may prevent you from staying
              signed in to the Service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#F2F7F7] mb-3">6. Data Retention</h2>
            <p className="text-[#A8B2B2] leading-relaxed">
              We retain your data for as long as your account is active or as needed to provide the
              Service. If you delete your account, we will delete or anonymize your personal data within
              a reasonable period, except where retention is required by law. Board and card data
              associated with your account will be deleted upon account deletion.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#F2F7F7] mb-3">7. Children's Privacy</h2>
            <p className="text-[#A8B2B2] leading-relaxed">
              ZeroBoard is not intended for children under the age of 13. We do not knowingly collect
              personal information from children under 13. If we become aware that a child under 13 has
              provided us with personal information, we will take steps to delete that information
              promptly.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#F2F7F7] mb-3">8. Changes to This Privacy Policy</h2>
            <p className="text-[#A8B2B2] leading-relaxed">
              We may update this Privacy Policy from time to time. We will notify you of significant
              changes by updating the "Last updated" date at the top of this page. Your continued use of
              the Service after any changes constitutes your acceptance of the updated Privacy Policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#F2F7F7] mb-3">9. Contact</h2>
            <p className="text-[#A8B2B2] leading-relaxed">
              If you have questions about this Privacy Policy or how we handle your data, please contact
              us at{' '}
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
