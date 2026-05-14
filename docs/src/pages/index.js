import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';

import Heading from '@theme/Heading';
import styles from './index.module.css';

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to="/docs/intro">
            Get Started - Read Documentation 📚
          </Link>
        </div>
      </div>
    </header>
  );
}

export default function Home() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={`Welcome to ${siteConfig.title}`}
      description="A direct peer-to-peer Pong game built with Pears">
      <HomepageHeader />
      <main style={{ padding: '2rem', textAlign: 'center' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
          <Heading as="h2" style={{ marginBottom: '1rem' }}>
            What is P2P Pong?
          </Heading>
          <p style={{ fontSize: '1.1rem', lineHeight: '1.6' }}>
            P2P Pong is a classic Pong game that connects two players directly — no servers, no middlemen!
            Built with Pears P2P technology, Hyperswarm for peer discovery, and Hypercore for a shared, persistent leaderboard.
          </p>
        </div>
      </main>
    </Layout>
  );
}
