import React from 'react';
import { Timeline } from 'antd';
import { Link } from 'gatsby';
import { getPostSubtract } from '../../utils/tools';

const TimeLineItem = props => {
  const {
    data: {
      node: { frontmatter = {} },
    },
  } = props;

  const { title, contentUrl } = getPostSubtract(frontmatter);

  return (
    <Timeline.Item position="right" color="green">
      <Link to={contentUrl}>{title}</Link>
    </Timeline.Item>
  );
};

export default TimeLineItem;
