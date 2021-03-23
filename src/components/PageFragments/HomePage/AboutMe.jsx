import React from 'react';
import { Row, Col } from 'antd';
import { OutboundLink } from 'gatsby-plugin-google-analytics';
import AboutTile from '../../AbouTile';
import { stripTags, domHtml } from '../../../utils/stripTags';

import SEO from '../../Seo';

const pageText = {
  paraOne:
    '你好少年，我是追谏，目前是工作于@神策数据。14年华东师范大学毕业，从猎头站始发、途径HR、当前停靠技术站😆。主用NodeJS、ReactJS，开发B端产品。',
  paraTwo: `除了技术，对历史和教育投入精力较多。受媳妇儿影响，对法律亦略有涉猎。一路狂奔在成为新一代斜杠青年的路上。🤪🤪`,
};

const AboutMe = () => {
  const description = `${pageText.paraOne} ${stripTags(pageText.paraTwo)}`;
  return (
    <div style={{ marginBottom: '16px' }}>
      <div>
        <SEO title="About" description={description} path="" />
        <h1 className="titleSeparate">关于</h1>
        <p>
          你好，我是追谏，现任
          <OutboundLink href="https://www.sensorsdata.cn/" target="_blank">
            @神策数据
          </OutboundLink>
          前端工程师。14年华东师范大学毕业，从猎头站始发、途径HR、当前停靠技术站😆。主用NodeJS、ReactJS，开发B端产品。
        </p>
        <p dangerouslySetInnerHTML={domHtml(pageText.paraTwo)} />
      </div>
      <Row gutter={[20, 20]}>
        <Col xs={24} sm={24} md={12} lg={8}>
          <AboutTile
            img="location.png"
            height={60}
            alt="location image"
            textH4="土生土长东北银"
            textH3="但不能喝酒"
          />
        </Col>
        <Col xs={24} sm={24} md={12} lg={8}>
          <AboutTile
            img="bike-1.png"
            alt="motorcycle image"
            textH4="骑行"
            textH3="Always on the way"
          />
        </Col>
        <Col xs={24} sm={24} md={12} lg={8}>
          <AboutTile img="dive.png" alt="coffee image" textH4="AOW" textH3="愿疫情早日结束" />
        </Col>
        <Col xs={24} sm={24} md={12} lg={8}>
          <AboutTile
            img="billiards.png"
            alt="meeting image"
            textH4="中式 + 斯诺克"
            textH3="人菜瘾大"
          />
        </Col>

        <Col xs={24} sm={24} md={12} lg={8}>
          <AboutTile
            img="home-office.png"
            alt="web image"
            textH4={`”自学“工程师`}
            textH3="感谢开源"
            height={60}
            width={60}
          />
        </Col>
        <Col xs={24} sm={24} md={12} lg={8}>
          <AboutTile
            img="graduation.jpeg"
            alt="graduation image"
            textH4="学士学位"
            textH3="信息学"
            height={60}
            width={60}
          />
        </Col>
      </Row>
    </div>
  );
};
export default AboutMe;
