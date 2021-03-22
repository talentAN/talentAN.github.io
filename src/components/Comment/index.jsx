/* eslint-disable func-names */
/* Vendor imports */
import React from 'react';
/* App imports */
import Config from '../../../config';

class Comments extends React.Component {
  componentDidMount() {
    const { pageCanonicalUrl, pageId } = this.props;

    if (window.DISQUS) {
      window.DISQUS.reset({
        reload: true,
        config() {
          this.page.url = pageCanonicalUrl;
          this.page.identifier = pageId;
        },
      });
    } else {
      window.disqus_config = () => {
        this.page.url = pageCanonicalUrl;
        this.page.identifier = pageId;
      };
      (function () {
        // eslint-disable-next-line no-undef
        const d = document;
        const s = d.createElement('script');
        s.src = Config.disqusScript;
        s.setAttribute('data-timestamp', +new Date());
        (d.head || d.body).appendChild(s);
      })();
    }
  }

  render() {
    return (
      <div>
        <div id="disqus_thread" />
      </div>
    );
  }
}

export default Comments;
