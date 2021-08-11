import React from 'react';
import moment from 'moment';
import { Link } from 'gatsby';
import style from './postCard.module.less';
import Utils from '../../utils/pageUtils';
import { trackBlog } from '../../track';

const PostCard = props => {
  const {
    data: {
      node: { frontmatter = {} },
    },
  } = props;

  const {
    hot = false,
    recommended = false,
    isTranslated = false,
    title: _title,
    excerpt = '',
    tags = [],
    date = '',
    path,
  } = frontmatter;
  const showHot = !!hot;
  const showRecommended = !showHot && recommended;
  const title = isTranslated ? `[译] ${_title}` : _title;

  const contentUrl = Utils.resolvePageUrl(path);

  return (
    <div className={style.postCard} onClick={() => trackBlog(contentUrl)}>
      <Link to={contentUrl}>
        <div
          className={style.postCardImg}
          style={{
            backgroundImage: frontmatter
              ? `url(${frontmatter.cover.childImageSharp.fluid.src})`
              : `url('')`,
            backgroundPositionX: 'center',
          }}
        />
      </Link>
      <div className={style.mrTp20}>
        <Link to={contentUrl}>
          <p>
            <span className={style.dateHolder}>
              {date ? moment(date).format('MMM Do YYYY') : ''}
            </span>
          </p>
          <h3>
            {showHot && <span style={{ marginRight: '4px' }}>🔥</span>}
            {showRecommended && <span style={{ marginRight: '4px' }}>👍</span>}
            {title}
          </h3>
          <p>{excerpt}</p>
        </Link>
        <p>
          {tags.map(tag => (
            <Link to={Utils.resolvePageUrl(`tags/${tag}`)} key={tag}>
              <span className={style.tag}>#{tag}</span>
            </Link>
          ))}
        </p>
      </div>
    </div>
  );
};

export default PostCard;
