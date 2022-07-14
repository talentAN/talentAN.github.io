import React from 'react';
import moment from 'moment';
import { Link } from 'gatsby';
import Utils from '../../utils/pageUtils';
import { getPostSubtract } from '../../utils/tools';
import style from './postCard.module.less';

const PostCard = props => {
  const {
    data: {
      node: { frontmatter = {} },
    },
  } = props;

  const { excerpt = '', tags = [], date = '' } = frontmatter;

  const { title, contentUrl, label_viewed } = getPostSubtract(frontmatter);

  return (
    <div className={style.postCard}>
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
          <h3>{title}</h3>
          <p>{excerpt}</p>
        </Link>
        <p>
          {tags.map(tag => (
            <Link
              to={Utils.resolvePageUrl(
                `tags/${tag === '聪明人的个人成长' ? 'Personal Development for Smart People' : tag}`
              )}
              key={tag}
            >
              <span className={style.tag}>#{tag}</span>
            </Link>
          ))}
        </p>
      </div>
    </div>
  );
};

export default PostCard;
