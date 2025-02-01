import chalk from 'chalk';

const banner = () => {
  const text = `
  ▗▖ ▗▖ ▗▄▖ ▗▄▄▄▄▖▗▖ ▗▖▗▖ ▗▖ ▗▄▖ 
  ▐▌▗▞▘▐▌ ▐▌   ▗▞▘▐▌ ▐▌▐▌ ▐▌▐▌ ▐▌
  ▐▛▚▖ ▐▛▀▜▌ ▗▞▘  ▐▌ ▐▌▐▛▀▜▌▐▛▀▜▌
  ▐▌ ▐▌▐▌ ▐▌▐▙▄▄▄▖▝▚▄▞▘▐▌ ▐▌▐▌ ▐▌
                               
  `;

  const separator = "═".repeat(60);
  return `${chalk.cyan(text)}\n${chalk.white(separator)}`;
};

export default banner;
