import React, { useState, useEffect, useRef } from 'react';
import { Row, Col } from 'antd';
import { Link } from 'gatsby';
import { OutboundLink } from 'gatsby-plugin-google-analytics';
import AboutTile from '../../AbouTile';
import SEO from '../../Seo';
import QrCode from '../../../images/qr-code.jpg';

const AboutMe = () => {
  const [showCode, setShowCode] = useState(false);
  const QrRefEntry = useRef();
  const QrRef = useRef();

  useEffect(() => {
    const hideQrCode = e => {
      if (e.target !== QrRef.current && e.target !== QrRefEntry.current) {
        setShowCode(false);
      }
    };
    document.addEventListener('click', hideQrCode);
    return () => {
      document.removeEventListener('click', hideQrCode);
    };
  }, []);

  return (
    <div style={{ marginBottom: '16px' }}>
      <div>
        <SEO title="关于" path="" />
        <h1 className="titleSeparate">关于</h1>
        <p>你好，我是追谏。</p>
        <p>
          14年华东师范大学毕业，职业生涯从猎头站始发、途径HR、当前停靠技术站😆，现任
          <OutboundLink href="https://www.sensorsdata.cn/" target="_blank">
            @神策数据
          </OutboundLink>
          前端工程师。
        </p>
        <p>
          详见这篇
          <Link to={'/blog/from-hr-to-developer'}>《HR转型研发那些事儿》</Link>
        </p>
        <p>
          除了技术，对历史和教育较有兴趣。受媳妇儿影响，对法律亦略有涉猎。一路狂奔在成为新一代斜杠青年的路上。🤪🤪
        </p>
        <p>
          网站统计数据，可以
          <Link to={'/static'}>点击这里</Link>查看，
          <Link to={'/tags/Personal%20Development%20for%20Smart%20People'}>
            《聪明人的个人成长》
          </Link>
          是目前最热门系列~
        </p>
        <p>
          微信公众号
          <span
            ref={QrRefEntry}
            style={{ color: '#1890ff', fontWeight: 'bold', cursor: 'pointer' }}
            onClick={() => setShowCode(true)}
          >
            追谏
          </span>
          ，欢迎关注~
        </p>
      </div>
      {showCode && <img ref={QrRef} src={QrCode} />}
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
          <AboutTile img="dive.png" alt="coffee image" textH4="潜水" textH3="愿疫情早日结束" />
        </Col>
        <Col xs={24} sm={24} md={12} lg={8}>
          <AboutTile img="badminton.png" alt="meeting image" textH4="羽毛球" textH3="人菜瘾大" />
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
