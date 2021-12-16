import React from 'react';
import { Layout } from 'antd';
import Header from '../components/PageLayout/Header';
import SidebarWrapper from '../components/PageLayout/Sidebar';
import AboutMe from '../components/PageFragments/HomePage/AboutMe';
import Skills,{Recommends} from '../components/PageFragments/HomePage/SkillProgress';

const HomePage = () => (
  <Layout className="outerPadding">
    <Layout className="container">
      <Header />
      <SidebarWrapper>
        <AboutMe />
        <Skills />
        <Recommends />
      </SidebarWrapper>
    </Layout>
  </Layout>
);

export default HomePage;
