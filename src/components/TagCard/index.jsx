import React from 'react';
import { Link } from 'gatsby';
import { trackTag } from '../../track';
import Config from '../../../config';
import Utils from '../../utils/pageUtils';
import style from './tags.module.less';

const TagCard = props => {
  const { img, name, description, color } = props;
  const tagPage = Config.pages.tag;

  return (
    <Link
      className={style.tagCard}
      to={Utils.resolvePageUrl(
        tagPage,
        name === '聪明人的个人成长' ? 'Personal Development for Smart People' : name
      )}
      onClick={() => trackTag(Utils.resolvePageUrl(tagPage, name))}
    >
      <div className={style.tagCard}>
        <div
          className={style.tagImg}
          style={{
            backgroundImage: `url(${img})`,
          }}
        />
        <div className={style.pd20px}>
          <div className="textCenter">
            <h3 style={{ color }}>#{name}</h3>
          </div>
          <p>{description}</p>
        </div>
      </div>
    </Link>
  );
};

export default TagCard;
