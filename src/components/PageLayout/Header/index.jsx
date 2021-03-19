import React, { useState } from 'react';
import { Link } from 'gatsby';
import { Layout } from 'antd';
import { header } from '../../../configs/page';
import 'font-awesome/less/font-awesome.less';
import style from './header.module.less';
import '../../../styles/global.less';
import { useWindowSize } from '../../../utils/hooks';

export default () => {
  const [menu, setMenu] = useState(false);

  const [width] = useWindowSize();
  const toggleMenu = () => {
    if (width !== 0 && width <= 768) {
      setMenu(!menu);
    }
  };
  return (
    <>
      <div
        className={style.circleMenu}
        role="button"
        tabIndex="0"
        onKeyDown={toggleMenu}
        onClick={toggleMenu}
      >
        <div className={`${style.hamburger} ${menu ? style.menuIcon : null}`}>
          <div className={style.line} />
          <div className={style.line} />
          <div className={style.hamburgerText}>目录</div>
        </div>
      </div>
      <Layout
        className={`${style.navWrap} ${menu ? null : style.hidden} ${menu ? style.openMenu : null}`}
      >
        <div className={style.backgroundDiv}>
          <ul className={style.nav}>
            {header.map(item => {
              const { label, link } = item;
              return (
                <li className={style.navItem}>
                  <Link to={link} onClick={toggleMenu} activeClassName={style.anchorActive}>
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </Layout>
    </>
  );
};
