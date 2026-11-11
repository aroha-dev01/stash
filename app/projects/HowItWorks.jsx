const STEPS = [
  ['Make a project', 'One per thing you build: a client site, an app, an agent, a launch. Start from a template or empty.'],
  ['File skills by folder', 'Search the library from each folder (Frontend, Backend, UI/UX, Content) and add what that part needs, with a line on why.'],
  ['Name it to your agent', '“I’m working on project ABC.” Your agent calls get_project over MCP and builds with your picks, session after session.'],
];

export default function HowItWorks() {
  return (
    <section className='k-pj-how' aria-labelledby='pj-how-h'>
      <h2 id='pj-how-h' className='k-h3'>How projects work</h2>
      <ol>
        {STEPS.map(([t, d]) => (
          <li key={t}>
            <b>{t}</b>
            <span>{d}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
