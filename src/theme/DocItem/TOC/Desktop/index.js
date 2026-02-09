import React, { useEffect } from 'react';
import { ThemeClassNames } from '@docusaurus/theme-common';
import { useDoc } from '@docusaurus/plugin-content-docs/client';
import TOC from '@theme/TOC';

export default function DocItemTOCDesktop() {
  const { toc, frontMatter } = useDoc();

  useEffect(() => {
    const tocContainer = document.querySelector(
      `.${ThemeClassNames.docs.docTocDesktop}`,
    );

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (
          mutation.type === 'attributes' &&
          mutation.attributeName === 'class'
        ) {
          const target = mutation.target;
          if (
            target.classList.contains('table-of-contents__link--active')
          ) {
            // Avoid scrolling if the user is interacting with the TOC
            if (tocContainer && tocContainer.matches(':hover')) {
              return;
            }

            if (tocContainer) {
              const linkRect = target.getBoundingClientRect();
              const containerRect = tocContainer.getBoundingClientRect();

              // Calculate center position
              const relativeTop = linkRect.top - containerRect.top;
              const newScrollTop = tocContainer.scrollTop + relativeTop - (containerRect.height / 2) + (linkRect.height / 2);

              tocContainer.scrollTo({
                top: newScrollTop,
                behavior: 'smooth',
              });
            }
            break; // Found the active link, no need to process other mutations
          }
        }
      }
    });

    if (tocContainer) {
      observer.observe(tocContainer, {
        attributes: true,
        subtree: true,
        attributeFilter: ['class'],
      });
    }

    return () => observer.disconnect();
  }, []);

  return (
    <TOC
      toc={toc}
      minHeadingLevel={frontMatter.toc_min_heading_level}
      maxHeadingLevel={frontMatter.toc_max_heading_level}
      className={ThemeClassNames.docs.docTocDesktop}
    />
  );
}
