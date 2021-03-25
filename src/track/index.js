import { trackCustomEvent } from 'gatsby-plugin-google-analytics';
//TODO: 傻逼了，google里还没设置白名单呢，track个屁呀...
export const trackBlog = path => {
  trackCustomEvent({
    // string - required - The object that was interacted with (e.g.video)
    category: 'blog',
    // string - required - Type of interaction (e.g. 'play')
    action: 'Click',
    // number - optional - Numeric value associated with the event. (e.g. A product ID)
    value: path,
  });
};

export const trackTag = path => {
  trackCustomEvent({
    category: 'tag',
    action: 'Click',
    value: path,
  });
};
