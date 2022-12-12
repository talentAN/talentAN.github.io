import React from 'react';
import { Layout, Button } from 'antd';
import { graphql } from 'gatsby';
import {Li} from './Card'
import style from './us.module.less';

export const query = graphql`
  {
    file(base: { eq: "404.png" }) {
      childImageSharp {
        fluid(maxWidth: 500) {
          ...GatsbyImageSharpFluid_tracedSVG
        }
      }
    }
  }
`;

export default ({ data }) => (
  <div className={style.root}>
    <Li />
  </div>
);


// 模板来源：https://www.bilibili.com/video/BV15K4y1L7wn/?vd_source=94345be4ef35a691ddca9853107a06f6
/**
 * TODO: 
 * - rotate3d() 
 * 
 * 
 * 
 * 
 * */ 