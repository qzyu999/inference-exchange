import { PublicPage } from '../components/PublicPage'

export function About() {
  return (
    <PublicPage title="About Us">
      <p className="ie-public-page-mission">Empowering and enabling everybody everywhere with affordable AI.</p>
      <section>
        <h2>Supply meets demand</h2>
        <p>The freedom to tinker, invent, and shape the future with AI at prices people around the world can afford.</p>
      </section>
      <section>
        <h2>Community-driven action</h2>
        <p>You can consume from an OpenAI-compatible API and also provide your idle compute to earn passive income.</p>
      </section>
      <section>
        <h2>Built on the Open Confidential Inference Protocol (OCIP)</h2>
        <p>Know the security levels of each hardware configuration.</p>
      </section>
      <section>
        <h2>Built by Jared Yu.</h2>
        <p><a href="https://github.com/qzyu999/inference-exchange">View the project on GitHub</a></p>
      </section>
    </PublicPage>
  )
}
