import Link from "next/link";

export default function MagazinePage() {
  return (
    <div className="min-h-screen flex flex-col relative overflow-x-hidden">
      {/* Main Content */}
      <main className="flex-grow pt-16 md:pt-24 pb-32 px-6 md:px-16 max-w-[1600px] mx-auto w-full relative">
        {/* Brand Masthead */}
        <div className="w-full flex flex-col items-center justify-center mb-16 md:mb-24 border-b border-outline-variant/30 pb-12">
          <Link
            href="/"
            className="font-display text-5xl md:text-7xl text-primary tracking-[0.2em] uppercase text-center font-bold hover:opacity-70 transition-opacity"
          >
            WE TALES
          </Link>
        </div>

        {/* Article Header */}
        <header className="mb-20 md:mb-32 relative z-10 max-w-5xl mx-auto text-center px-4">
          <div className="mb-8 inline-block px-5 py-1.5 rounded-full bg-surface-bright text-secondary border border-outline-variant/40 text-xs tracking-widest uppercase font-medium">
            Interview / Vol. 04
          </div>
          <h1 className="font-display text-4xl md:text-6xl lg:text-7xl text-primary mb-8 tracking-tight leading-tight">
            林晨：在平凡中策展诗意
          </h1>
          <p className="text-lg md:text-xl text-on-surface-variant max-w-3xl mx-auto mt-8 italic leading-relaxed font-display">
            Lin Chen: Curating Poetry in the Ordinary. Exploring the spaces
            between memory, urban decay, and the relentless pace of modern city
            life through the lens of a quiet observer.
          </p>
        </header>

        {/* Article Content */}
        <div className="max-w-5xl mx-auto">
          <div className="column-text">
            <p className="font-body text-base text-on-surface-variant leading-[1.8] drop-cap mb-8 text-justify">
              The light falls differently in the forgotten corners of the city.
              While the metropolis rushes forward, building glass towers that
              reflect the future, Lin Chen seeks the shadows of the past. His
              work is not merely photography; it is an act of preservation—a
              deliberate slowing down of time to capture what is about to
              vanish. Walking into his studio feels like stepping out of the
              current century. Surrounded by analog equipment and walls
              plastered with test prints, there is a distinct sense of
              intentionality. Every object seems to have been carefully chosen,
              every space thoughtfully considered.
            </p>
          </div>

          {/* Pull Quote */}
          <div className="my-24 md:my-32 pl-8 md:pl-16 relative">
            <div className="pull-quote-mark relative z-10">
              <p className="font-display text-3xl md:text-5xl text-primary font-bold leading-tight tracking-tight max-w-4xl">
                城市跑得太快，如果我们不停下来记录那些微小的瞬间，它们就真的消失了。
              </p>
            </div>
            <footer className="mt-8 text-sm text-secondary uppercase tracking-[0.2em] flex items-center gap-4 font-semibold">
              <span className="w-12 h-[1px] bg-secondary/40 block" />
              Lin Chen
            </footer>
          </div>

          <div className="column-text">
            <p className="font-body text-base text-on-surface-variant leading-[1.8] mb-8 text-justify">
              His recent exhibition, &ldquo;The Architecture of Silence,&rdquo;
              strips away the noise of urban existence to reveal the structural
              beauty of emptiness. By photographing spaces just moments before
              they are demolished or repurposed, he creates a dialogue between
              presence and absence. The images force the viewer to confront the
              ephemeral nature of their surroundings.
            </p>
            <p className="font-body text-base text-on-surface-variant leading-[1.8] text-justify">
              &ldquo;I don&apos;t want to create nostalgia,&rdquo; he explains,
              sipping a cup of dark tea, his eyes tracing the skyline visible
              through the studio&apos;s lone window. &ldquo;Nostalgia is
              passive. I want to create awareness. The ordinary is only ordinary
              until you realize you will never see it again.&rdquo;
            </p>
          </div>
        </div>

        {/* Back to home */}
        <div className="max-w-5xl mx-auto mt-24 text-center">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-secondary hover:text-primary transition-colors font-semibold"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            返回首页
          </Link>
        </div>
      </main>
    </div>
  );
}
