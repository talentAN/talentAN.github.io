import React from 'react';
import { Affix, Layout, Row, Col, message } from 'antd';
import FA from 'react-fontawesome';
import FeatherIcon from 'feather-icons-react';
import { globalHistory } from '@reach/router';
import { OutboundLink } from 'gatsby-plugin-google-analytics';
import style from './sidebar.module.less';
import { useWindowSize } from '../../../utils/hooks';
import ME from '../../../configs/me';

const { Content } = Layout;

const DomContent = () => {
  const { name, title, social, birth, locate, email, company } = ME;
  const socialLinks = Object.keys(social).map(key => {
    return (
      <OutboundLink
        key={key}
        href={social[key]}
        target="_blank"
        label="button"
        rel="noopener noreferrer"
      >
        <FA name={key} />
      </OutboundLink>
    );
  });
  return (
    <aside>
      <div className={style.profileAvatar} />
      <div className={`${style.name} centerAlign`}>
        <div className={`${style.boxName} centerAlign`}>
          <h2>
            <span>{name}</span>
          </h2>
        </div>
        <div className={`${style.badge} ${style.badgeGray}`}>{title}</div>
        <div className="centerAlign box">{socialLinks}</div>
        <ul className={`box ${style.badge} contactBlock`}>
          <li className={style.contactBlockItem} style={{ alignItems: 'flex-start' }}>
            <span style={{ marginRight: '16px' }}>
              <FeatherIcon size="19" icon="calendar" />{' '}
            </span>
            {birth}
          </li>
          <li className={style.contactBlockItem} style={{ alignItems: 'flex-start' }}>
            <span style={{ marginRight: '16px' }}>
              <FeatherIcon size="19" icon="map-pin" />
            </span>{' '}
            {locate}
          </li>
          <li className={style.contactBlockItem} style={{ alignItems: 'flex-start' }}>
            <span style={{ marginRight: '16px' }}>
              <FeatherIcon size="19" icon="mail" />
            </span>{' '}
            <span>{email}</span>
          </li>
          <li className={style.contactBlockItem} style={{ alignItems: 'flex-start' }}>
            <span style={{ marginRight: '16px' }}>
              <FeatherIcon size="19" icon="flag" />{' '}
            </span>
            <OutboundLink
              href="https://www.sensorsdata.cn/"
              target="_blank"
              style={{ color: '#000', fontWeight: 600 }}
            >
              {company}
            </OutboundLink>
          </li>
        </ul>
        <div className={style.resumeDownload} onClick={() => message.info('当前稳定，感谢关注~')}>
          {/* <a download target="_blank" style={{ display: 'flex', alignItems: 'center' }}>
            <FeatherIcon size="19" icon="download" style={{ marginRight: '8px' }} />
            简历
          </a> */}
        </div>
      </div>
    </aside>
  );
};

const Sidebar = props => {
  const [width] = useWindowSize();
  const { children } = props;
  const { pathname } = globalHistory.location;
  let domContent = <DomContent />;
  if (width > 997) {
    domContent = (
      <Affix offsetTop={0}>
        <DomContent />
      </Affix>
    );
  }
  if (width < 768) {
    domContent = <></>;
    if (pathname === '/') {
      domContent = <DomContent />;
    }
  }
  return (
    <>
      <Layout>
        <Content className={`${style.content} ${style.background}`}>
          <Row>
            <Col sm={24} md={9} lg={6} className={style.sidebarContent}>
              {domContent}
            </Col>
            <Col sm={24} md={15} lg={18}>
              <Layout className={`${style.background} ${style.boxContent} borderRadiusSection`}>
                {children}
              </Layout>
            </Col>
          </Row>
        </Content>
      </Layout>
    </>
  );
};

export const Sidebar404 = props => {
  const { children } = props;
  return (
    <Layout>
      <Content className={`${style.content} ${style.background} `}>
        <Row>
          <Col sm={24} md={24} lg={24}>
            <Layout className={`${style.background} ${style.boxContent} ${style.sideBar404Radius}`}>
              {children}
            </Layout>
          </Col>
        </Row>
      </Content>
    </Layout>
  );
};

export default Sidebar;
