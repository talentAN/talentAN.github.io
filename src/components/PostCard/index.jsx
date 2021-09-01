import React from 'react';
import moment from 'moment';
import { Link } from 'gatsby';
import Utils from '../../utils/pageUtils';
import { formatNumber } from '../../utils/tools';
import { trackBlog } from '../../track';
import style from './postCard.module.less';

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
    totalCount,
  } = frontmatter;

  const showHot = !!hot;
  const showRecommended = !showHot && recommended;

  const title = isTranslated ? `[译] ${_title}` : _title;
  const contentUrl = Utils.resolvePageUrl(path);
  const label_viewed = `${formatNumber(totalCount)}阅`;

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
          <p className={style.tips}>
            <span className={style.dateHolder}>{moment(date).format('MMM Do YYYY')}</span>
            <span className={style.totalCount}>{label_viewed}</span>
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
