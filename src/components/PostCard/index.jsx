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
  } = frontmatter;
  const showHot = !!hot;
  const showRecommended = !showHot && recommended;
  const title = isTranslated ? `[译] ${_title}` : _title;

  return (
    <div
      className={style.postCard}
      onClick={() => trackBlog(Utils.resolvePageUrl(frontmatter.path))}
    >
      <Link to={Utils.resolvePageUrl(frontmatter.path)}>
        <div
          className={style.postCardImg}
          style={{
            backgroundImage: frontmatter
              ? `url(${frontmatter.cover.childImageSharp.fluid.src})`
              : `url('')`,
            backgroundPositionX: 'center',
          }}
        />
        <div className={style.mrTp20}>
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
          <p style={{ color: '#ce6d96' }}>
            {tags.map(tag => (
              <span key={tag} style={{ marginRight: '12px' }}>
                #{tag}
              </span>
            ))}
          </p>
        </div>
      </Link>
    </div>
  );
};

export default PostCard;
