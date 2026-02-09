import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import styles from './index.module.css';

import useBaseUrl from '@docusaurus/useBaseUrl';

const features = [
  {
    title: 'System Design',
    description: 'Learn how to design scalable systems.',
    link: '/systemDesign',
    icon: '/img/logo.svg',
    tags: [
      { name: 'System Design', color: 'blue' },
      { name: 'Advanced', color: 'purple' },
      { name: 'Concept', color: 'gray' },
    ],
  },
  {
    title: 'DevOps',
    description: 'CI/CD, Docker, Kubernetes, and more.',
    link: '/devOps',
    icon: '/img/Docker.svg',
    tags: [
      { name: 'DevOps', color: 'orange' },
      { name: 'Intermediate', color: 'yellow' },
      { name: 'Guide', color: 'gray' },
    ],
  },
  {
    title: 'React',
    description: 'Modern frontend development with React.',
    link: '/reactJS',
    icon: '/img/React.js.svg',
    tags: [
      { name: 'Frontend', color: 'blue' },
      { name: 'Beginner', color: 'green' },
      { name: 'Guide', color: 'gray' },
    ],
  },
  {
    title: 'Next.js',
    description: 'The React Framework for the Web.',
    link: '/nextJS',
    icon: '/img/Next.js.svg',
    tags: [
      { name: 'Frontend', color: 'blue' },
      { name: 'Intermediate', color: 'yellow' },
      { name: 'Guide', color: 'gray' },
    ],
  },
  {
    title: 'Flask',
    description: 'Lightweight WSGI web application framework.',
    link: '/flask',
    icon: '/img/Flask.svg',
    tags: [
      { name: 'Backend', color: 'purple' },
      { name: 'Beginner', color: 'green' },
      { name: 'Guide', color: 'gray' },
    ],
  },
  {
    title: 'Java',
    description: 'Object-oriented programming language.',
    link: '/java',
    icon: '/img/Java.svg',
    tags: [
      { name: 'Language', color: 'orange' },
      { name: 'Beginner', color: 'green' },
      { name: 'Reference', color: 'gray' },
    ],
  },
  {
    title: 'MongoDB',
    description: 'NoSQL database for modern apps.',
    link: '/mongoDB',
    icon: '/img/MongoDB.svg',
    tags: [
      { name: 'Database', color: 'green' },
      { name: 'Beginner', color: 'green' },
      { name: 'Reference', color: 'gray' },
    ],
  },
  {
    title: 'PostgreSQL',
    description: 'Advanced open-source relational database.',
    link: '/postgreSQL',
    icon: '/img/PostgreSQL.svg',
    tags: [
      { name: 'Database', color: 'green' },
      { name: 'Intermediate', color: 'yellow' },
      { name: 'Reference', color: 'gray' },
    ],
  },
];

export default function Home() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout
      title={`Notes`}
      description="Notes created for Learning, Reference and Interview Preparation"
    >
      <div className={styles.cardContainer}>
        {features.map((feature, index) => (
          <Link key={index} to={feature.link} className={styles.cardLink}>
            <article className={styles.card}>
              <div className={styles.cardLeft}>
                <img 
                  src={feature.icon} 
                  alt={feature.title} 
                  className={styles.icon} 
                />
              </div>
              <div className={styles.cardRight}>
                <h3 className={styles.title}>{feature.title}</h3>
                <p className={styles.description}>
                  {feature.description}
                </p>
                <div className={styles.cardFooter}>
                  {feature.tags?.map((tag, tagIndex) => (
                    <span 
                      key={tagIndex} 
                      className={clsx(styles.tag, styles[tag.color])}
                    >
                      {tag.name}
                    </span>
                  ))}
                  {!feature.tags && <span className={styles.tag}>Docs</span>}
                </div>
              </div>
            </article>
          </Link>
        ))}
      </div>
    </Layout>
  );
}
