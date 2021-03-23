import { trackCustomEvent } from 'gatsby-plugin-google-analytics';

export const trackInSiteClick = path => {
  trackCustomEvent({
    // string - required - The object that was interacted with (e.g.video)
    category: 'in-site',
    // string - required - Type of interaction (e.g. 'play')
    action: 'Click',
    // number - optional - Numeric value associated with the event. (e.g. A product ID)
    value: path,
  });
};
